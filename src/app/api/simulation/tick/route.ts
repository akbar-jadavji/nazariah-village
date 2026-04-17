import { NextResponse } from "next/server";
import { serverClient, AgentRow } from "@/lib/supabase";
import { generateTileMap } from "@/data/tilemap";
import { findPath } from "@/engine/pathfinding";
import { BUILDING_ID_TO_KEY, ENTERABLE_BUILDING_IDS } from "@/engine/buildings";

export const runtime = "nodejs";

// Chunk 3: random wander + A* pathfinding. No AI calls yet.
// One tick advances every agent by at most one tile.

const TICKS_PER_DAY = 96;

type AgentUpdate = {
  id: string;
  current_x?: number;
  current_y?: number;
  current_building?: string | null;
  path?: { x: number; y: number }[] | null;
  next_decision_tick?: number;
  status?: string;
};

function timeOfDayForTick(tick: number):
  "morning" | "midday" | "afternoon" | "evening" | "night" {
  const h = tick % TICKS_PER_DAY;
  if (h < 20) return "morning";
  if (h < 48) return "midday";
  if (h < 64) return "afternoon";
  if (h < 80) return "evening";
  return "night";
}

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

export async function POST() {
  const supabase = serverClient();
  const tilemap = generateTileMap();

  // --- Load state ---
  const [stateRes, agentsRes] = await Promise.all([
    supabase
      .from("simulation_state")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("agents").select("*"),
  ]);

  if (stateRes.error) {
    return NextResponse.json({ error: stateRes.error.message }, { status: 500 });
  }
  if (agentsRes.error) {
    return NextResponse.json({ error: agentsRes.error.message }, { status: 500 });
  }
  if (!stateRes.data) {
    return NextResponse.json({ error: "World not initialized" }, { status: 409 });
  }

  const sim = stateRes.data;
  const agents = (agentsRes.data ?? []) as AgentRow[];

  // Respect pause — return current state without advancing.
  if (sim.is_paused) {
    return NextResponse.json({ state: sim, agents, skipped: true });
  }

  const newTick = sim.current_tick + 1;
  const newDay = sim.current_day + (newTick % TICKS_PER_DAY === 0 ? 1 : 0);
  const newTimeOfDay = timeOfDayForTick(newTick);

  // --- Plan & resolve moves ---
  // Occupancy map of tiles claimed by other agents THIS tick.
  // Agents inside a building don't occupy a tile.
  const occupancy = new Map<string, string>(); // "x,y" -> agentId
  for (const a of agents) {
    if (a.current_building) continue;
    occupancy.set(`${a.current_x},${a.current_y}`, a.id);
  }
  const keyOf = (x: number, y: number) => `${x},${y}`;

  const updates: AgentUpdate[] = [];

  for (const agent of agents) {
    // Skip if still "busy" (e.g. sitting inside a building)
    if (newTick < agent.next_decision_tick) continue;

    // If inside a building and the wait is over → exit at that building's entry tile.
    if (agent.current_building) {
      updates.push({
        id: agent.id,
        current_building: null,
        path: null,
        next_decision_tick: newTick + 1 + rand(3),
        status: "idle",
      });
      continue;
    }

    // If agent has a path → try to advance one step.
    if (agent.path && agent.path.length > 0) {
      const nextStep = agent.path[0];
      const nextKey = keyOf(nextStep.x, nextStep.y);

      // If another agent already holds that tile this tick, wait.
      const holder = occupancy.get(nextKey);
      if (holder && holder !== agent.id) {
        // Wait; try again next tick.
        continue;
      }

      // Move.
      occupancy.delete(keyOf(agent.current_x, agent.current_y));
      occupancy.set(nextKey, agent.id);
      const remaining = agent.path.slice(1);

      // Arrived? Check if we ended on a building entry and maybe enter.
      if (remaining.length === 0) {
        const entry = tilemap.buildingEntries.find(
          (b) => b.entryX === nextStep.x && b.entryY === nextStep.y &&
                 ENTERABLE_BUILDING_IDS.has(b.id),
        );
        if (entry && Math.random() < 0.5) {
          occupancy.delete(nextKey); // agent is indoors, frees the tile
          updates.push({
            id: agent.id,
            current_x: nextStep.x,
            current_y: nextStep.y,
            current_building: BUILDING_ID_TO_KEY[entry.id] ?? String(entry.id),
            path: null,
            next_decision_tick: newTick + 4 + rand(8), // stay 4–12 ticks
            status: "resting",
          });
          continue;
        }
        // Plain arrival — no building entered.
        updates.push({
          id: agent.id,
          current_x: nextStep.x,
          current_y: nextStep.y,
          path: null,
          next_decision_tick: newTick + 1 + rand(3),
          status: "idle",
        });
        continue;
      }

      updates.push({
        id: agent.id,
        current_x: nextStep.x,
        current_y: nextStep.y,
        path: remaining,
        status: "walking",
      });
      continue;
    }

    // No path — pick a random walkable destination and plan a route.
    // Avoid destinations that are tiles currently held by another agent, or
    // the agent's own tile. Try a few candidates before giving up.
    let planned: { x: number; y: number }[] | null = null;
    for (let attempt = 0; attempt < 8 && !planned; attempt++) {
      const tx = 1 + rand(tilemap.width - 2);
      const ty = 1 + rand(tilemap.height - 2);
      if (tx === agent.current_x && ty === agent.current_y) continue;
      if (tilemap.collision[ty][tx] === 1) continue;
      const holder = occupancy.get(keyOf(tx, ty));
      if (holder && holder !== agent.id) continue;
      // Path must avoid static collision AND tiles held by other agents RIGHT
      // NOW — but we allow the goal tile itself (checked inside findPath).
      planned = findPath(
        { x: agent.current_x, y: agent.current_y },
        { x: tx, y: ty },
        tilemap.width,
        tilemap.height,
        (x, y) => {
          if (tilemap.collision[y][x] === 1) return true;
          const h = occupancy.get(keyOf(x, y));
          return !!(h && h !== agent.id);
        },
      );
    }

    if (!planned) continue; // try again next tick

    updates.push({
      id: agent.id,
      path: planned,
      status: "walking",
    });
  }

  // --- Persist updates ---
  // Supabase JS doesn't do true batch updates across different PKs, but our
  // agent count is small (~12). Fire them off in parallel.
  if (updates.length > 0) {
    const results = await Promise.all(
      updates.map((u) => {
        const { id, ...rest } = u;
        return supabase.from("agents").update(rest).eq("id", id);
      }),
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      return NextResponse.json(
        { error: `Agent update failed: ${firstErr.message}` },
        { status: 500 },
      );
    }
  }

  const { error: stateErr } = await supabase
    .from("simulation_state")
    .update({
      current_tick: newTick,
      current_day: newDay,
      time_of_day: newTimeOfDay,
    })
    .eq("id", sim.id);
  if (stateErr) {
    return NextResponse.json({ error: stateErr.message }, { status: 500 });
  }

  // Return the fresh state by re-reading (positions we just updated).
  const { data: freshAgents } = await supabase
    .from("agents")
    .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping, path")
    .order("name", { ascending: true });

  return NextResponse.json({
    state: {
      ...sim,
      current_tick: newTick,
      current_day: newDay,
      time_of_day: newTimeOfDay,
    },
    agents: freshAgents ?? [],
  });
}
