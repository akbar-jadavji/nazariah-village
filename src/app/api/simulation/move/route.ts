/**
 * /api/simulation/move  — fast movement tick, no AI
 *
 * Called every ~300 ms by the client. Advances all walking agents by up to
 * MOVE_SPEED tiles along their pre-planned paths. When a path completes the
 * agent becomes idle and will be picked up by the next /think call.
 *
 * Also handles:
 *  - Agents inside buildings whose dwell time has expired → exit them.
 *  - Night override: idle agents at night get a go-home path set.
 *
 * Returns the fresh agent list (positions + status only, for the canvas).
 */

import { NextRequest, NextResponse } from "next/server";
import { serverClient, AgentRow } from "@/lib/supabase";
import { generateTileMap } from "@/data/tilemap";
import { findPath } from "@/engine/pathfinding";
import { BUILDING_ID_TO_KEY, ENTERABLE_BUILDING_IDS } from "@/engine/buildings";

export const runtime = "nodejs";
export const maxDuration = 10;

const MOVE_SPEED = 3; // tiles advanced per move call

function rand(n: number) { return Math.floor(Math.random() * n); }

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function timeOfDayForTick(tick: number) {
  const h = tick % 96;
  if (h < 20) return "morning";
  if (h < 48) return "midday";
  if (h < 64) return "afternoon";
  if (h < 80) return "evening";
  return "night";
}

function buildingEntry(key: string | null, tilemap: ReturnType<typeof generateTileMap>) {
  if (!key) return null;
  for (const b of tilemap.buildingEntries) {
    if (BUILDING_ID_TO_KEY[b.id] === key) return b;
  }
  return null;
}

export async function POST(req: NextRequest) {
  void req;
  const supabase = serverClient();
  const tilemap = generateTileMap();

  // Read current state for time-of-day (night override)
  const { data: sim } = await supabase
    .from("simulation_state")
    .select("current_tick, is_paused")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sim || sim.is_paused) {
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping, action_emoji, action_description")
      .order("name");
    return NextResponse.json({ agents: agents ?? [], skipped: true });
  }

  const currentTick = sim.current_tick;
  const timeOfDay = timeOfDayForTick(currentTick);

  // Fetch agents needing movement or exit
  const { data: rawAgents } = await supabase
    .from("agents")
    .select("*");
  const agents = (rawAgents ?? []) as AgentRow[];

  type AgentUpdate = Partial<AgentRow> & { id: string };
  const updates: AgentUpdate[] = [];

  // Occupancy map for collision
  const occupancy = new Map<string, string>();
  for (const a of agents) {
    if (!a.current_building) occupancy.set(`${a.current_x},${a.current_y}`, a.id);
  }

  // 1. Exit building occupants whose dwell time is over
  const exiting = agents.filter(
    (a) => a.current_building && currentTick >= a.next_decision_tick,
  );
  for (const agent of exiting) {
    updates.push({
      id: agent.id,
      current_building: null,
      path: null,
      next_decision_tick: 0, // 0 = "needs a decision now" — think loop picks it up
      status: "idle",
    });
  }

  // 2. Walking agents — advance MOVE_SPEED steps
  const walking = agents.filter(
    (a) => !a.current_building && a.path && a.path.length > 0,
  );

  for (const agent of walking) {
    let path = [...agent.path!];
    let cx = agent.current_x;
    let cy = agent.current_y;
    let enteredBuilding: string | null = null;

    for (let step = 0; step < MOVE_SPEED && path.length > 0; step++) {
      const nextStep = path[0];
      const nextKey = `${nextStep.x},${nextStep.y}`;
      const holder = occupancy.get(nextKey);
      if (holder && holder !== agent.id) break; // blocked — stop here this tick

      occupancy.delete(`${cx},${cy}`);
      cx = nextStep.x;
      cy = nextStep.y;
      occupancy.set(nextKey, agent.id);
      path = path.slice(1);

      if (path.length === 0) {
        // Arrived — check if we can enter a building
        const entry = tilemap.buildingEntries.find(
          (b) => b.entryX === cx && b.entryY === cy && ENTERABLE_BUILDING_IDS.has(b.id),
        );
        if (entry && Math.random() < 0.5) {
          enteredBuilding = BUILDING_ID_TO_KEY[entry.id] ?? String(entry.id);
          occupancy.delete(nextKey);
        }
        break;
      }
    }

    if (enteredBuilding) {
      updates.push({
        id: agent.id,
        current_x: cx,
        current_y: cy,
        current_building: enteredBuilding,
        path: null,
        next_decision_tick: currentTick + 4 + rand(8),
        status: "resting",
      });
    } else if (path.length === 0) {
      updates.push({
        id: agent.id,
        current_x: cx,
        current_y: cy,
        path: null,
        next_decision_tick: 0,
        status: "idle",
      });
    } else {
      updates.push({
        id: agent.id,
        current_x: cx,
        current_y: cy,
        path,
        status: "walking",
      });
    }
  }

  // 3. Night override: idle agents not at home get a go-home path
  if (timeOfDay === "night") {
    const needsHome = agents.filter(
      (a) =>
        !a.current_building &&
        (!a.path || a.path.length === 0) &&
        a.current_building !== a.home_building_id,
    );
    for (const agent of needsHome) {
      const alreadyUpdated = updates.some((u) => u.id === agent.id);
      if (alreadyUpdated) continue;
      const homeEntry = buildingEntry(agent.home_building_id, tilemap);
      if (!homeEntry) continue;
      const path = findPath(
        { x: agent.current_x, y: agent.current_y },
        { x: homeEntry.entryX, y: homeEntry.entryY },
        tilemap.width, tilemap.height,
        (x, y) => tilemap.collision[y][x] === 1,
      );
      if (path) updates.push({ id: agent.id, path, status: "walking" });
    }
  }

  // Apply updates
  if (updates.length > 0) {
    await Promise.all(
      updates.map(({ id, ...rest }) =>
        supabase.from("agents").update(rest).eq("id", id),
      ),
    );
  }

  // Return lean position data for canvas
  const { data: freshAgents } = await supabase
    .from("agents")
    .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping, action_emoji, action_description")
    .order("name");

  return NextResponse.json({ agents: freshAgents ?? [] });
}
