/**
 * /api/simulation/tick  — the "think" loop, AI decisions only
 *
 * Called every ~5 s by the client. Handles:
 *   1. AI action decisions for idle agents (path=null, current_building=null)
 *   2. Conversations between agents who decided to talk_to each other
 *   3. Periodic reflections + goal formation
 *   4. Advancing sim state (tick, day, time_of_day)
 *
 * Movement (path advancement) is handled separately by /api/simulation/move
 * which runs every ~300 ms without any LLM calls.
 */

import { NextRequest, NextResponse } from "next/server";
import { serverClient, AgentRow } from "@/lib/supabase";
import { generateTileMap } from "@/data/tilemap";
import { findPath } from "@/engine/pathfinding";
import { BUILDING_ID_TO_KEY } from "@/engine/buildings";
import { WORLD_OBJECTS, getObject, nearestObjectForVerb, VERB_TUNING, buildStateDetail } from "@/data/world-objects";
import type { ActivityVerb, InteractableObject } from "@/lib/types";
import {
  callJSON, embed,
  MODEL_LOW,
  ActionDecisionSchema, ImportanceScoresSchema, InternalThoughtSchema,
  ReflectionSchema, GoalSchema,
} from "@/lib/openai";
import { runConversation, RelationshipSnap } from "@/engine/conversation";
import { TileMap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─── Constants ───────────────────────────────────────────────────────────────

const TICKS_PER_DAY = 96;
const TALK_RADIUS = 3;
const TALK_COOLDOWN_TICKS = 15;
const MEMORY_RETRIEVE_COUNT = 30;
const MEMORY_CONTEXT_COUNT = 10;
const INTERNAL_THOUGHT_CHANCE = 0.25;
const W_RECENCY = 0.3;
const W_RELEVANCE = 0.3;
const W_IMPORTANCE = 0.4;
const RECENCY_DECAY = 0.995;
// 0 = agent needs a decision immediately (set by move loop when path completes)
const NEEDS_DECISION = 0;

// All valid building keys (including new cottages)
const ALL_BUILDING_KEYS =
  "inn, library, bakery, workshop, apothecary, plaza, park, " +
  "cottage_1, cottage_2, cottage_3, cottage_4, cottage_5, " +
  "cottage_6, cottage_7, cottage_8, cottage_9, cottage_10";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rand(n: number) { return Math.floor(Math.random() * n); }

function timeOfDayForTick(tick: number): "morning" | "midday" | "afternoon" | "evening" | "night" {
  const h = tick % TICKS_PER_DAY;
  if (h < 20) return "morning";
  if (h < 48) return "midday";
  if (h < 64) return "afternoon";
  if (h < 80) return "evening";
  return "night";
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Brief location for conversation context — "inside The Enchanted Hearth",
 * "near Starfall Plaza", etc. Doesn't include room substructure (the
 * conversation engine wants a short anchor, not a list).
 */
function describeLocation(agent: AgentRow, tilemap: TileMap): string {
  if (agent.current_building) {
    const entry = tilemap.buildingEntries.find(
      (b) => BUILDING_ID_TO_KEY[b.id] === agent.current_building,
    );
    return entry ? `inside ${entry.name}` : "inside a building";
  }
  let nearest: { name: string; d: number } | null = null;
  for (const b of tilemap.buildingEntries) {
    const d = dist(agent.current_x, agent.current_y, b.entryX, b.entryY);
    if (!nearest || d < nearest.d) nearest = { name: b.name, d };
  }
  if (nearest && nearest.d <= 4) return `near ${nearest.name}`;
  return `somewhere in the village (tile ${agent.current_x},${agent.current_y})`;
}

/**
 * Verbose location string for the action-decision observation. When the agent
 * is inside a building with declared rooms, lists them so the LLM can picture
 * substructure ("I'm in the inn, which has a Main Hall, Kitchen, Guest Rooms").
 * This gives the prompt enough nested context that an agent at Starfall Plaza
 * stops proposing to meet at Starfall Plaza.
 */
function describeLocationRich(agent: AgentRow, tilemap: TileMap): string {
  const brief = describeLocation(agent, tilemap);
  if (!agent.current_building) return brief;
  const entry = tilemap.buildingEntries.find(
    (b) => BUILDING_ID_TO_KEY[b.id] === agent.current_building,
  );
  if (!entry?.rooms || entry.rooms.length === 0) return brief;
  const roomList = entry.rooms.map((r) => `${r.name} (${r.description})`).join("; ");
  return `${brief} — sub-areas: ${roomList}`;
}

function buildingEntry(key: string | null, tilemap: TileMap) {
  if (!key) return null;
  for (const b of tilemap.buildingEntries) {
    if (BUILDING_ID_TO_KEY[b.id] === key) return b;
  }
  return null;
}

// ── Activity verb helpers ───────────────────────────────────────────────────

const ACTIVITY_VERBS: ActivityVerb[] = ["eat", "sleep", "rest", "pray", "read", "forage", "bake"];

/** A single row of object_states. */
type ObjectStateRow = {
  object_id: string;
  state: string;
  state_detail: string | null;
  last_updated_tick: number;
  last_actor_id: string | null;
};

function isActivityVerb(v: string): v is ActivityVerb {
  return (ACTIVITY_VERBS as string[]).includes(v);
}

/** Per-agent state string for the prompt: "You feel hungry (75/100) and rested." */
function bodyStateDescription(agent: AgentRow): string {
  const h = agent.hunger ?? 40;
  const e = agent.energy ?? 70;
  const hungerLabel = h >= 80 ? "ravenous" : h >= 60 ? "hungry" : h >= 30 ? "comfortably fed" : "well-fed";
  const energyLabel = e <= 20 ? "exhausted" : e <= 40 ? "tired" : e <= 70 ? "alert" : "well-rested";
  return `You feel ${hungerLabel} (hunger ${h}/100) and ${energyLabel} (energy ${e}/100).`;
}

/** Compact, prompt-friendly list of object choices grouped by verb. */
function buildObjectMenu(): string {
  const byVerb: Record<string, InteractableObject[]> = {};
  for (const o of WORLD_OBJECTS) {
    (byVerb[o.verb] ??= []).push(o);
  }
  const lines: string[] = [];
  for (const v of ACTIVITY_VERBS) {
    const list = byVerb[v] ?? [];
    if (list.length === 0) continue;
    lines.push(`- ${v} → target_object one of: ${list.map((o) => `"${o.id}" (${o.name})`).join(", ")}`);
  }
  return lines.join("\n");
}

function buildObservation(
  agent: AgentRow,
  allAgents: AgentRow[],
  tilemap: TileMap,
  tick: number,
  timeOfDay: string,
  day: number,
  objectStates: Map<string, ObjectStateRow>,
): string {
  // Verbose location for the decision prompt — includes the building's
  // sub-areas so the LLM can imagine moving between bar/kitchen/guest rooms.
  const location = describeLocationRich(agent, tilemap);
  const nearby = allAgents
    .filter((a) =>
      a.id !== agent.id &&
      !a.current_building &&
      dist(agent.current_x, agent.current_y, a.current_x, a.current_y) <= 6,
    )
    .map((a) => a.name);
  const nearbyStr = nearby.length === 0 ? "Nobody is nearby." : `Nearby: ${nearby.join(", ")}.`;

  // Smallville-style object perception. Only include objects within 6 tiles
  // AND in an interesting state (i.e. not the default). The free-text detail
  // is concatenated after the named state.
  const objectsNearby: string[] = [];
  for (const o of WORLD_OBJECTS) {
    if (dist(agent.current_x, agent.current_y, o.x, o.y) > 6) continue;
    const row = objectStates.get(o.id);
    if (!row) continue;
    const defaultState = o.states?.default;
    if (defaultState && row.state === defaultState && !row.state_detail) continue;
    const detail = row.state_detail ? ` — ${row.state_detail}` : "";
    objectsNearby.push(`${o.name} (${row.state}${detail})`);
  }
  const objectsStr = objectsNearby.length === 0
    ? ""
    : ` Nearby objects of note: ${objectsNearby.join("; ")}.`;

  return `[Day ${day}, ${timeOfDay}, tick ${tick}] I am ${location}. ${nearbyStr}${objectsStr}`;
}

type MemoryRow = {
  id: string; sim_tick: number; type: string;
  content: string; importance: number; relevance: number;
};

async function retrieveMemories(
  agentId: string,
  embedding: number[],
  currentTick: number,
  supabase: ReturnType<typeof serverClient>,
): Promise<MemoryRow[]> {
  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embedding,
    p_agent_id: agentId,
    match_count: MEMORY_RETRIEVE_COUNT,
  });
  if (error || !data) return [];
  return (data as MemoryRow[])
    .map((m) => ({
      ...m,
      score:
        W_RECENCY * Math.pow(RECENCY_DECAY, currentTick - m.sim_tick) +
        W_RELEVANCE * m.relevance +
        W_IMPORTANCE * m.importance,
    }))
    .sort((a, b) => (b as typeof b & { score: number }).score - (a as typeof a & { score: number }).score)
    .slice(0, MEMORY_CONTEXT_COUNT);
}

type GoalSnap = { id: string; description: string; steps: string[] | null; priority: number };

async function decideAction(
  agent: AgentRow,
  observation: string,
  memories: MemoryRow[],
  activeGoals: GoalSnap[],
  timeOfDay: string,
  day: number,
  nearbyAgents: { name: string; ticksSinceSpoke: number | null }[],
) {
  const memoryBlock = memories.length === 0
    ? "No relevant memories yet."
    : memories.map((m, i) => `${i + 1}. [${m.type}] ${m.content}`).join("\n");

  const goalBlock = activeGoals.length === 0
    ? "No active goals."
    : activeGoals.map((g, i) => {
        const steps = Array.isArray(g.steps) && g.steps.length > 0
          ? ` Steps: ${g.steps.join(" → ")}` : "";
        return `${i + 1}. [priority ${g.priority}/5] ${g.description}${steps}`;
      }).join("\n");

  const talkOption = nearbyAgents.length > 0
    ? `- talk_to: start a conversation. Set target_agent to their exact name. Nearby:\n${
        nearbyAgents.map((a) => {
          const r = a.ticksSinceSpoke === null ? "never spoken" : `last spoke ${a.ticksSinceSpoke} ticks ago`;
          return `  • ${a.name} (${r})`;
        }).join("\n")}`
    : "";

  const user = `Current observation: ${observation}
${bodyStateDescription(agent)}

Active goals (act on these):
${goalBlock}

Recent memories:
${memoryBlock}

Available actions:
- move_to: walk to a building. target_building: one of: ${ALL_BUILDING_KEYS}. Use null to wander.
- idle: stay and do something small.
- go_home: return to ${agent.home_building_id}.
${talkOption}

PHYSICAL ACTIVITY VERBS — these actually DO something. Each takes time and changes your body state. The engine walks you to the target object automatically.
${buildObjectMenu()}

How to choose: if hunger > 60 you probably want to eat. If energy < 30 you probably want to sleep (target_object = your own cottage bed id, e.g. bed_${agent.home_building_id}). Pray/read/forage/rest are mood and routine activities.

It is ${timeOfDay} on Day ${day}. Act on your goals. Be a real person — you have a life here, routines, people you care about.

GOAL COMPLETION POLICY (important — be GENEROUS, not cautious):
Goals are short-term reminders, not permanent obligations. Retire them in completed_goal_indices when ANY of these are true:
  • You have done the thing, even partially or imperfectly.
  • You are currently doing the thing right now (the act of doing it counts).
  • The goal no longer reflects your real intent (you've moved on, the moment passed, circumstances changed).
  • The goal is older than today and you haven't acted on it — let it go.
Default to retiring. A short, fresh goal list is better than a long stale one.

Also write: action_description (one present-tense sentence like "${agent.name} is checking on the bread loaves") and action_emoji (1-3 emojis that represent the action, e.g. 🍞🔥).
Respond with JSON: { "chosen_action": "...", "target_building": ... or null, "target_agent": ... or null, "target_object": "..." or null, "reasoning": "...", "action_description": "...", "action_emoji": "...", "completed_goal_indices": [int, ...] }`;

  return callJSON({
    model: MODEL_LOW,
    system: `You are ${agent.name}, a villager in Nazariah.\n${agent.backstory}\nTraits: ${agent.traits.join(", ")}.\nAlways respond with valid JSON only.`,
    user,
    schema: ActionDecisionSchema,
    temperature: 0.85,
    maxTokens: 250,
  });
}

async function generateThought(agent: AgentRow, observation: string): Promise<string | null> {
  try {
    const result = await callJSON({
      model: MODEL_LOW,
      system: `You are ${agent.name}. Traits: ${agent.traits.join(", ")}. Write a brief first-person internal thought (one sentence). Respond with JSON: { "thought": "..." }`,
      user: `Context: ${observation}`,
      schema: InternalThoughtSchema,
      temperature: 0.9,
      maxTokens: 200,
    });
    return result.thought;
  } catch { return null; }
}

async function scoreImportance(contents: string[]): Promise<number[]> {
  if (contents.length === 0) return [];
  try {
    const result = await callJSON({
      model: MODEL_LOW,
      system: `Rate each memory's long-term significance for a village character (0.0 trivial → 1.0 life-changing). Respond: { "scores": [float, ...] }`,
      user: contents.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      schema: ImportanceScoresSchema,
      temperature: 0.3,
      maxTokens: 100,
    });
    const scores = result.scores.map((s) => Math.max(0, Math.min(1, s)));
    while (scores.length < contents.length) scores.push(0.3);
    return scores.slice(0, contents.length);
  } catch {
    return contents.map(() => 0.3);
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = serverClient();
  const tilemap = generateTileMap();

  const body = await req.json().catch(() => ({})) as {
    playerX?: number; playerY?: number; playerName?: string;
  };
  const { playerX, playerY, playerName } = body;

  const [stateRes, agentsRes] = await Promise.all([
    supabase.from("simulation_state").select("*")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("agents").select("*"),
  ]);

  if (stateRes.error) return NextResponse.json({ error: stateRes.error.message }, { status: 500 });
  if (!stateRes.data) return NextResponse.json({ error: "World not initialized" }, { status: 409 });

  const sim = stateRes.data;
  if (sim.is_paused) return NextResponse.json({ state: sim, agents: agentsRes.data, skipped: true });

  const agents = (agentsRes.data ?? []) as AgentRow[];
  const newTick = sim.current_tick + 1;
  const newDay = sim.current_day + (newTick % TICKS_PER_DAY === 0 ? 1 : 0);
  const newTimeOfDay = timeOfDayForTick(newTick);

  // ── Activity completion phase ────────────────────────────────────────────
  // Any agent in status=doing_activity whose next_decision_tick has been
  // reached has just finished their verb. Apply the verb's state delta,
  // append a memory, retire matching goals, and clear the activity fields.
  // These agents then re-enter the decision pool below as freshly-idle.
  const activityCompleteUpdates: { id: string; [k: string]: unknown }[] = [];
  const activityCompleteMemories: {
    agent_id: string; sim_tick: number; type: "observation";
    content: string; embedding: null; importance: number;
    last_accessed: string; access_count: number;
  }[] = [];
  const activityCompletedGoalKeywords: { agentId: string; verb: ActivityVerb }[] = [];
  // Object state mutations queued during this phase (one entry per object
  // that should flip to its `afterAction` state).
  const objectStateUpserts: {
    object_id: string; state: string; state_detail: string | null; last_actor_id: string;
  }[] = [];
  for (const a of agents) {
    if (a.status === "doing_activity" && a.current_activity_verb && a.next_decision_tick <= newTick) {
      const verb = a.current_activity_verb as ActivityVerb;
      const tuning = VERB_TUNING[verb];
      const obj = getObject(a.current_activity_target ?? "");
      const objName = obj?.name ?? "the spot";
      const flavour = tuning?.completionFlavour(a.name, objName) ?? `${a.name} finished ${verb}.`;
      const newHunger = Math.max(0, Math.min(100, (a.hunger ?? 40) + (tuning?.hungerDelta ?? 0)));
      const newEnergy = Math.max(0, Math.min(100, (a.energy ?? 70) + (tuning?.energyDelta ?? 0)));
      activityCompleteUpdates.push({
        id: a.id,
        status: "idle",
        action_description: flavour,
        action_emoji: "✨",
        current_activity_verb: null,
        current_activity_target: null,
        hunger: newHunger,
        energy: newEnergy,
        next_decision_tick: NEEDS_DECISION, // re-decide immediately
      });
      activityCompleteMemories.push({
        agent_id: a.id, sim_tick: newTick, type: "observation",
        content: flavour, embedding: null, importance: 0.4,
        last_accessed: new Date().toISOString(), access_count: 0,
      });
      activityCompletedGoalKeywords.push({ agentId: a.id, verb });
      // Object state transition on completion (the Smallville perception layer).
      // Each object with a `states.afterAction` gets bumped, with a free-text
      // detail crafted from the actor + object kind.
      if (obj?.states?.afterAction) {
        const detail = buildStateDetail(obj.kind, obj.states.afterAction, a.name);
        objectStateUpserts.push({
          object_id: obj.id,
          state: obj.states.afterAction,
          state_detail: detail,
          last_actor_id: a.id,
        });
      }
      // Reflect into the in-memory agent row so the rest of the tick sees fresh state.
      a.status = "idle";
      a.current_activity_verb = null;
      a.current_activity_target = null;
      a.next_decision_tick = NEEDS_DECISION;
      a.hunger = newHunger;
      a.energy = newEnergy;
    }
  }
  if (activityCompleteUpdates.length > 0) {
    await Promise.all(activityCompleteUpdates.map(({ id, ...rest }) =>
      supabase.from("agents").update(rest).eq("id", id),
    ));
    if (activityCompleteMemories.length > 0) {
      await supabase.from("memories").insert(activityCompleteMemories);
    }
    // Auto-complete any active goals whose description name-drops the verb the
    // agent just did. Loose substring match — pragmatic, no extra LLM call.
    for (const { agentId, verb } of activityCompletedGoalKeywords) {
      await supabase.from("goals")
        .update({ status: "completed", completed_at_tick: newTick })
        .eq("agent_id", agentId)
        .eq("status", "active")
        .ilike("description", `%${verb}%`);
    }
    // Object state transitions — upsert in parallel.
    if (objectStateUpserts.length > 0) {
      await Promise.all(objectStateUpserts.map((u) =>
        supabase.from("object_states").upsert({
          object_id: u.object_id,
          state: u.state,
          state_detail: u.state_detail,
          last_actor_id: u.last_actor_id,
          last_updated_tick: newTick,
        }, { onConflict: "object_id" }),
      ));
    }
  }

  // ── Periodic body-state drift ────────────────────────────────────────────
  // Hunger creeps up; energy drifts down. Single server-side UPDATE (one
  // HTTP round-trip via the agent_state_drift RPC) — much friendlier to the
  // Supabase connection pool than firing 25 parallel UPDATEs.
  for (const a of agents) {
    // Keep the in-memory rows in sync so the rest of the tick sees the new
    // values without an extra SELECT.
    a.hunger = Math.min(100, (a.hunger ?? 40) + 1);
    a.energy = Math.max(0,   (a.energy ?? 70) - 1);
  }
  const { error: driftErr } = await supabase.rpc("agent_state_drift", {
    hunger_inc: 1,
    energy_dec: 1,
  });
  if (driftErr) console.warn("agent_state_drift rpc failed:", driftErr.message);

  // ── Select agents needing AI decisions ───────────────────────────────────
  // Only idle agents: no path, not inside a building, next_decision_tick reached
  const aiDeciders = agents.filter((a) =>
    !a.current_building &&
    (!a.path || a.path.length === 0) &&
    a.status !== "doing_activity" && // still mid-activity → skip
    (a.next_decision_tick <= newTick || a.next_decision_tick === NEEDS_DECISION) &&
    newTimeOfDay !== "night",
  );

  if (aiDeciders.length === 0) {
    // Advance state and return quickly
    await supabase.from("simulation_state")
      .update({ current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay })
      .eq("id", sim.id);
    const { data: freshAgents } = await supabase.from("agents")
      .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping, action_emoji, action_description, hunger, energy, current_activity_verb, current_activity_target")
      .order("name");
    return NextResponse.json({
      state: { ...sim, current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay },
      agents: freshAgents ?? [], conversations: [], agentChatRequests: [],
    });
  }

  // ── World object state: fetch + decay stale ones ─────────────────────────
  // Pulled once per tick; passed into observations so agents can perceive
  // nearby state changes (oven "ready", etc.) without a per-agent query.
  const objectStates = new Map<string, ObjectStateRow>();
  {
    const { data: stateRows } = await supabase
      .from("object_states")
      .select("object_id, state, state_detail, last_updated_tick, last_actor_id");
    for (const r of (stateRows ?? []) as ObjectStateRow[]) objectStates.set(r.object_id, r);

    // Decay any object whose `afterAction` state has lingered too long, back
    // to its default. The detail is cleared so stale flavour doesn't bleed
    // into observations.
    const decayUpdates: { object_id: string; state: string }[] = [];
    for (const o of WORLD_OBJECTS) {
      if (!o.states?.afterAction || !o.states.decayTicks) continue;
      const row = objectStates.get(o.id);
      if (!row || row.state !== o.states.afterAction) continue;
      if (newTick - row.last_updated_tick < o.states.decayTicks) continue;
      const next = o.states.default;
      decayUpdates.push({ object_id: o.id, state: next });
      objectStates.set(o.id, { ...row, state: next, state_detail: null, last_updated_tick: newTick });
    }
    if (decayUpdates.length > 0) {
      await Promise.all(decayUpdates.map((u) =>
        supabase.from("object_states").update({
          state: u.state, state_detail: null, last_updated_tick: newTick,
        }).eq("object_id", u.object_id),
      ));
    }
  }

  // ── Phase 1: Observations + goals ────────────────────────────────────────
  const observations = new Map<string, string>();
  for (const a of aiDeciders) {
    observations.set(a.id, buildObservation(a, agents, tilemap, newTick, newTimeOfDay, newDay, objectStates));
  }

  const { data: goalsData } = await supabase.from("goals")
    .select("id, agent_id, description, steps, priority")
    .in("agent_id", aiDeciders.map((a) => a.id))
    .eq("status", "active")
    .order("priority", { ascending: false });

  const goalsByAgent = new Map<string, GoalSnap[]>();
  for (const g of goalsData ?? []) {
    const arr = goalsByAgent.get(g.agent_id) ?? [];
    arr.push({ id: g.id, description: g.description, steps: g.steps as string[] | null, priority: g.priority });
    goalsByAgent.set(g.agent_id, arr);
  }

  // ── Phase 2: Embed observations ──────────────────────────────────────────
  const embeddingResults = await Promise.allSettled(
    aiDeciders.map((a) => embed(observations.get(a.id)!)),
  );

  // ── Phase 3: Retrieve memories ────────────────────────────────────────────
  const memoryResults = await Promise.allSettled(
    aiDeciders.map((a, i) => {
      const emb = embeddingResults[i];
      if (emb.status !== "fulfilled") return Promise.resolve([] as MemoryRow[]);
      return retrieveMemories(a.id, (emb as PromiseFulfilledResult<number[]>).value, newTick, supabase);
    }),
  );

  // ── Phase 4: Build nearby-talkable lists ─────────────────────────────────
  const { data: relData } = await supabase.from("relationships")
    .select("agent_id, target_id, last_interaction_tick")
    .in("agent_id", aiDeciders.map((a) => a.id));
  const relRecency = new Map<string, number>();
  for (const r of relData ?? []) {
    if (r.last_interaction_tick) relRecency.set(`${r.agent_id}:${r.target_id}`, r.last_interaction_tick);
  }

  const nearbyTalkable = new Map<string, { name: string; ticksSinceSpoke: number | null }[]>();
  for (const agent of aiDeciders) {
    const nearby = agents
      .filter((a) =>
        a.id !== agent.id &&
        !a.current_building &&
        dist(agent.current_x, agent.current_y, a.current_x, a.current_y) <= TALK_RADIUS,
      )
      .map((a) => {
        const lastTick = relRecency.get(`${agent.id}:${a.id}`) ?? null;
        return { name: a.name, ticksSinceSpoke: lastTick !== null ? newTick - lastTick : null };
      });
    if (playerX !== undefined && playerY !== undefined && playerName) {
      if (dist(agent.current_x, agent.current_y, playerX, playerY) <= TALK_RADIUS) {
        const playerLast = relRecency.get(`${agent.id}:player`) ?? null;
        nearby.push({ name: playerName, ticksSinceSpoke: playerLast !== null ? newTick - playerLast : null });
      }
    }
    nearbyTalkable.set(agent.id, nearby);
  }

  // ── Phase 5: AI decisions ─────────────────────────────────────────────────
  const decisionResults = await Promise.allSettled(
    aiDeciders.map((a, i) =>
      decideAction(
        a,
        observations.get(a.id)!,
        memoryResults[i].status === "fulfilled" ? (memoryResults[i] as PromiseFulfilledResult<MemoryRow[]>).value : [],
        goalsByAgent.get(a.id) ?? [],
        newTimeOfDay,
        newDay,
        nearbyTalkable.get(a.id) ?? [],
      ),
    ),
  );

  // ── Phase 6: Internal thoughts for idle stays ─────────────────────────────
  const idleAgents = aiDeciders.filter((_, i) => {
    const dr = decisionResults[i];
    return dr.status === "fulfilled" && dr.value.chosen_action === "idle";
  });
  const thoughtResults = await Promise.allSettled(
    idleAgents.map((a) =>
      Math.random() < INTERNAL_THOUGHT_CHANCE
        ? generateThought(a, observations.get(a.id)!)
        : Promise.resolve(null),
    ),
  );

  // ── Phase 7: Importance scoring ───────────────────────────────────────────
  const importanceScores = await scoreImportance(aiDeciders.map((a) => observations.get(a.id)!));

  // ── Collect new memories ──────────────────────────────────────────────────
  type NewMemory = {
    agent_id: string; sim_tick: number; type: string; content: string;
    embedding: number[] | null; importance: number; last_accessed: string; access_count: number;
  };
  const newMemories: NewMemory[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < aiDeciders.length; i++) {
    newMemories.push({
      agent_id: aiDeciders[i].id,
      sim_tick: newTick,
      type: "observation",
      content: observations.get(aiDeciders[i].id)!,
      embedding: embeddingResults[i].status === "fulfilled"
        ? (embeddingResults[i] as PromiseFulfilledResult<number[]>).value : null,
      importance: importanceScores[i] ?? 0.3,
      last_accessed: now, access_count: 0,
    });
  }
  for (let i = 0; i < idleAgents.length; i++) {
    const tr = thoughtResults[i];
    if (tr.status === "fulfilled" && tr.value) {
      newMemories.push({
        agent_id: idleAgents[i].id, sim_tick: newTick, type: "internal_thought",
        content: tr.value, embedding: null, importance: 0.3,
        last_accessed: now, access_count: 0,
      });
    }
  }

  // ── Apply action decisions to agent rows ──────────────────────────────────
  type AgentUpdate = { id: string; [key: string]: unknown };
  const updates: AgentUpdate[] = [];

  // Goals each agent has just marked complete (collected here, retired in one
  // batched UPDATE after the loop so we don't fire one query per agent).
  const completedGoalIds: string[] = [];

  for (let i = 0; i < aiDeciders.length; i++) {
    const agent = aiDeciders[i];
    const dr = decisionResults[i];

    // Resolve completed_goal_indices → goal IDs using the same ordered list
    // the LLM saw (goalsByAgent is sorted by priority desc, then enumerated
    // 1-based in the prompt).
    if (dr.status === "fulfilled" && dr.value.completed_goal_indices?.length) {
      const goalsForAgent = goalsByAgent.get(agent.id) ?? [];
      for (const idx of dr.value.completed_goal_indices) {
        const goal = goalsForAgent[idx - 1];
        if (goal) completedGoalIds.push(goal.id);
      }
    }

    // Fallback: random wander if LLM failed
    if (dr.status === "rejected") {
      const randEntry = tilemap.buildingEntries[rand(tilemap.buildingEntries.length)];
      const path = findPath(
        { x: agent.current_x, y: agent.current_y },
        { x: randEntry.entryX, y: randEntry.entryY },
        tilemap.width, tilemap.height,
        (x, y) => tilemap.collision[y][x] === 1,
      );
      if (path) updates.push({ id: agent.id, path, status: "walking" });
      continue;
    }

    const d = dr.value;
    const emoji = d.action_emoji || "";
    const desc = d.action_description || "";

    if (d.chosen_action === "idle") {
      updates.push({
        id: agent.id, path: null,
        next_decision_tick: newTick + 3 + rand(4),
        status: "thinking",
        action_description: desc,
        action_emoji: emoji,
      });
      continue;
    }

    if (d.chosen_action === "go_home") {
      const homeEntry = buildingEntry(agent.home_building_id, tilemap);
      if (homeEntry) {
        const path = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: homeEntry.entryX, y: homeEntry.entryY },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
        if (path) updates.push({ id: agent.id, path, status: "walking", action_description: desc, action_emoji: emoji });
      }
      continue;
    }

    if (d.chosen_action === "talk_to") {
      // Handled below in conversation pipeline
      updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 1, status: "talking", action_emoji: "💬", action_description: desc });
      continue;
    }

    if (d.chosen_action === "move_to") {
      const target = buildingEntry(d.target_building ?? null, tilemap);
      if (target) {
        const path = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: target.entryX, y: target.entryY },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
        if (path) {
          updates.push({ id: agent.id, path, status: "walking", action_description: desc, action_emoji: emoji });
          continue;
        }
      }
      // No valid target — idle briefly
      updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 2 + rand(3), status: "idle", action_description: desc, action_emoji: emoji });
      continue;
    }

    // ── Physical activity verbs ──────────────────────────────────────────
    if (isActivityVerb(d.chosen_action)) {
      const verb = d.chosen_action as ActivityVerb;
      // Resolve the target object. LLM specifies id; if invalid or omitted,
      // fall back to the nearest valid object of that verb.
      let obj = d.target_object ? getObject(d.target_object) : undefined;
      if (!obj || obj.verb !== verb) {
        obj = nearestObjectForVerb(verb, agent.current_x, agent.current_y);
      }
      if (!obj) {
        // Shouldn't happen for any verb in WORLD_OBJECTS, but be safe.
        updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 2, status: "idle", action_description: desc, action_emoji: emoji });
        continue;
      }
      // Role lock — only named agent(s) can fire this verb here. Player is
      // exempt because the player UI bypasses this whole decision path.
      if (obj.roleLock) {
        const allowed = Array.isArray(obj.roleLock) ? obj.roleLock : [obj.roleLock];
        if (!allowed.includes(agent.name)) {
          updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 2, status: "idle", action_description: desc, action_emoji: emoji });
          continue;
        }
      }
      // Already AT the object? Start the activity immediately.
      const atObject = agent.current_x === obj.x && agent.current_y === obj.y;
      if (atObject) {
        const duration = VERB_TUNING[verb].durationTicks;
        updates.push({
          id: agent.id,
          path: null,
          status: "doing_activity",
          current_activity_verb: verb,
          current_activity_target: obj.id,
          action_description: desc,
          action_emoji: emoji,
          next_decision_tick: newTick + duration,
        });
        continue;
      }
      // Otherwise walk there; the move loop transitions to doing_activity on arrival.
      const path = findPath(
        { x: agent.current_x, y: agent.current_y },
        { x: obj.x, y: obj.y },
        tilemap.width, tilemap.height,
        (x, y) => tilemap.collision[y][x] === 1,
      );
      if (path) {
        updates.push({
          id: agent.id,
          path,
          status: "walking",
          current_activity_verb: verb,
          current_activity_target: obj.id,
          action_description: desc || `${agent.name} heads toward ${obj.name}.`,
          action_emoji: emoji || "🚶",
        });
        continue;
      }
      // No path — give up this tick.
      updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 2, status: "idle", action_description: desc, action_emoji: emoji });
    }
  }

  // ── Retire completed goals in a single batched query ─────────────────────
  if (completedGoalIds.length > 0) {
    await supabase.from("goals")
      .update({ status: "completed", completed_at_tick: newTick })
      .in("id", completedGoalIds);
  }

  // ── Auto-abandon stale goals so the list never grows unbounded ───────────
  // Active goals older than 80 ticks (~ one game day) without being touched
  // are abandoned. The LLM is asked to retire goals voluntarily, but it's
  // often cautious — this is the safety net that keeps the goal list clean.
  const STALE_THRESHOLD_TICKS = 80;
  await supabase.from("goals")
    .update({ status: "abandoned", completed_at_tick: newTick })
    .eq("status", "active")
    .lt("created_at_tick", newTick - STALE_THRESHOLD_TICKS);

  // ── Conversation pipeline ─────────────────────────────────────────────────
  const agentByName = new Map(agents.map((a) => [a.name, a]));
  const inConversation = new Set<string>();

  type ConvoPayload = {
    agentA: AgentRow; agentB: AgentRow;
    relAtoB: RelationshipSnap | null; relBtoA: RelationshipSnap | null;
    memsA: string[]; memsB: string[];
    location: string;
  };
  const convoPairs: ConvoPayload[] = [];

  for (let i = 0; i < aiDeciders.length; i++) {
    const agent = aiDeciders[i];
    const dr = decisionResults[i];
    if (dr.status !== "fulfilled" || dr.value.chosen_action !== "talk_to") continue;
    if (inConversation.has(agent.id)) continue;

    const targetName = dr.value.target_agent;
    if (!targetName) continue;
    const target = agentByName.get(targetName);
    if (!target || inConversation.has(target.id)) continue;
    if (target.current_building) continue;
    if (dist(agent.current_x, agent.current_y, target.current_x, target.current_y) > TALK_RADIUS) continue;

    const [relAB, relBA] = await Promise.all([
      supabase.from("relationships").select("*").eq("agent_id", agent.id).eq("target_id", target.id).maybeSingle(),
      supabase.from("relationships").select("*").eq("agent_id", target.id).eq("target_id", agent.id).maybeSingle(),
    ]);
    const [memARes, memBRes] = await Promise.all([
      supabase.from("memories").select("content").eq("agent_id", agent.id).eq("type", "conversation")
        .order("sim_tick", { ascending: false }).limit(3),
      supabase.from("memories").select("content").eq("agent_id", target.id).eq("type", "conversation")
        .order("sim_tick", { ascending: false }).limit(3),
    ]);

    const lastInteraction = relAB.data?.last_interaction_tick ?? 0;
    if (lastInteraction > 0 && newTick - lastInteraction < TALK_COOLDOWN_TICKS) {
      const familiarity = relAB.data?.familiarity ?? 0;
      if (Math.random() > (familiarity > 0.7 ? 0.25 : 0.1)) continue;
    }

    inConversation.add(agent.id);
    inConversation.add(target.id);

    const snap = (row: typeof relAB.data): RelationshipSnap | null =>
      row ? { familiarity: row.familiarity, sentiment: row.sentiment,
               summary: row.summary, interaction_count: row.interaction_count,
               last_interaction_tick: row.last_interaction_tick ?? undefined } : null;

    convoPairs.push({
      agentA: agent, agentB: target,
      relAtoB: snap(relAB.data), relBtoA: snap(relBA.data),
      memsA: (memARes.data ?? []).map((m) => m.content),
      memsB: (memBRes.data ?? []).map((m) => m.content),
      location: describeLocation(agent, tilemap),
    });
  }

  // Collect agents trying to talk to the player
  type AgentChatRequest = { agentId: string; agentName: string };
  const agentChatRequests: AgentChatRequest[] = [];
  for (let i = 0; i < aiDeciders.length; i++) {
    const agent = aiDeciders[i];
    const dr = decisionResults[i];
    if (dr.status !== "fulfilled" || dr.value.chosen_action !== "talk_to") continue;
    if (inConversation.has(agent.id)) continue;
    const targetName = dr.value.target_agent;
    if (playerName && targetName?.toLowerCase() === playerName.toLowerCase()) {
      agentChatRequests.push({ agentId: agent.id, agentName: agent.name });
    }
  }

  // Run all conversations in parallel
  type ConvoResult = { agentA: AgentRow; agentB: AgentRow; result: Awaited<ReturnType<typeof runConversation>> };
  const convoSettled = await Promise.allSettled(
    convoPairs.map(async (p): Promise<ConvoResult> => ({
      agentA: p.agentA, agentB: p.agentB,
      result: await runConversation(p.agentA, p.agentB, p.relAtoB, p.relBtoA, p.memsA, p.memsB, p.location, newTimeOfDay, newDay),
    })),
  );

  type ConvoTurn = { speaker: string; speakerId: string; line: string; thought: string };
  const convoSummaries: { agentAId: string; agentBId: string; agentAName: string; agentBName: string; turns: ConvoTurn[] }[] = [];
  const now2 = new Date().toISOString();

  for (const settled of convoSettled) {
    if (settled.status === "rejected") { console.error("Conversation failed:", settled.reason); continue; }
    const { agentA, agentB, result } = settled.value;

    // Persist the transcript. Previously this was built but never awaited,
    // which meant the Supabase thenable never fired — every conversation
    // since the world was init'd was generated, displayed, then dropped.
    // The relationships + memory-summary writes still ran, which is why the
    // bug stayed hidden until the inspector tried to read this table back.
    const { error: convoErr } = await supabase.from("conversations").insert({
      agent_a_id: agentA.id, agent_b_id: agentB.id, sim_tick: newTick, turns: result.turns,
    });
    if (convoErr) console.error("Conversation insert error:", convoErr.message);

    convoSummaries.push({
      agentAId: agentA.id, agentBId: agentB.id,
      agentAName: agentA.name, agentBName: agentB.name, turns: result.turns,
    });

    newMemories.push(
      { agent_id: agentA.id, sim_tick: newTick, type: "conversation", content: result.memoryA,
        embedding: null, importance: result.importance[0], last_accessed: now2, access_count: 0 },
      { agent_id: agentB.id, sim_tick: newTick, type: "conversation", content: result.memoryB,
        embedding: null, importance: result.importance[1], last_accessed: now2, access_count: 0 },
    );

    const upsertRel = async (agentId: string, targetId: string, sentDelta: number, existingRel: RelationshipSnap | null) => {
      const newCount = (existingRel?.interaction_count ?? 0) + 1;
      await supabase.from("relationships").upsert({
        agent_id: agentId, target_id: targetId,
        familiarity: Math.min(1, (existingRel?.familiarity ?? 0) + 0.05),
        sentiment: Math.max(-1, Math.min(1, (existingRel?.sentiment ?? 0) + sentDelta)),
        summary: newCount % 5 === 0 ? result.relationshipNote : (existingRel?.summary ?? null),
        last_interaction_tick: newTick,
        interaction_count: newCount,
      }, { onConflict: "agent_id,target_id" });
    };

    const pair = convoPairs.find((p) => p.agentA.id === agentA.id && p.agentB.id === agentB.id);
    await Promise.all([
      upsertRel(agentA.id, agentB.id, result.sentimentDeltaA, pair?.relAtoB ?? null),
      upsertRel(agentB.id, agentA.id, result.sentimentDeltaB, pair?.relBtoA ?? null),
    ]);

    // Persist commitment-based goals
    const commitmentInserts = [
      result.commitmentA ? { agent_id: agentA.id, goal: result.commitmentA } : null,
      result.commitmentB ? { agent_id: agentB.id, goal: result.commitmentB } : null,
    ].filter(Boolean) as { agent_id: string; goal: NonNullable<typeof result.commitmentA> }[];
    if (commitmentInserts.length > 0) {
      await supabase.from("goals").insert(
        commitmentInserts.map(({ agent_id, goal }) => ({
          agent_id, description: goal.description, priority: goal.priority,
          status: "active", steps: goal.steps, created_at_tick: newTick, completed_at_tick: null,
        })),
      );
    }

    // After conversations, both agents become idle
    updates.push(
      { id: agentA.id, path: null, next_decision_tick: newTick + 2 + rand(3), status: "idle", action_emoji: "💬", action_description: `${agentA.name} just finished talking with ${agentB.name}` },
      { id: agentB.id, path: null, next_decision_tick: newTick + 2 + rand(3), status: "idle", action_emoji: "💬", action_description: `${agentB.name} just finished talking with ${agentA.name}` },
    );
  }

  // ── Persist memories ──────────────────────────────────────────────────────
  if (newMemories.length > 0) {
    const { error: memErr } = await supabase.from("memories").insert(newMemories);
    if (memErr) console.error("Memory insert error:", memErr.message);
  }

  // ── Apply agent updates ───────────────────────────────────────────────────
  if (updates.length > 0) {
    const results = await Promise.all(
      updates.map(({ id, ...rest }) => supabase.from("agents").update(rest).eq("id", id)),
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) return NextResponse.json({ error: `Agent update failed: ${firstErr.message}` }, { status: 500 });
  }

  // ── Periodic reflections + goal formation ─────────────────────────────────
  const REFLECTION_EVERY = 20;
  if (newTick % REFLECTION_EVERY === 0 && agents.length > 0) {
    const candidates = agents.filter((a) => !a.current_building).sort(() => Math.random() - 0.5).slice(0, 2);
    await Promise.allSettled(candidates.map(async (agent) => {
      try {
        const { data: mems } = await supabase.from("memories").select("type, content, sim_tick")
          .eq("agent_id", agent.id).order("sim_tick", { ascending: false }).limit(12);
        if (!mems || mems.length < 4) return;

        const reflection = await callJSON({
          model: MODEL_LOW,
          system: `You are ${agent.name}. Traits: ${agent.traits.join(", ")}. Write 1-2 brief reflective insights from your recent experiences. Respond: { "reflections": ["...", "..."] }`,
          user: mems.map((m) => `[${m.type}] ${m.content}`).join("\n"),
          schema: ReflectionSchema,
          temperature: 0.85,
          maxTokens: 400,
        });

        await supabase.from("memories").insert({
          agent_id: agent.id, sim_tick: newTick, type: "reflection",
          content: reflection.reflections.join(" "), embedding: null, importance: 0.7,
          last_accessed: new Date().toISOString(), access_count: 0,
        });

        if (Math.random() < 0.35) {
          const { data: active } = await supabase.from("goals").select("id")
            .eq("agent_id", agent.id).eq("status", "active").limit(1);
          if (!active || active.length === 0) {
            const goal = await callJSON({
              model: MODEL_LOW,
              system: `You are ${agent.name}. Based on your reflection, define one concrete personal goal. Respond: { "description": "...", "priority": 1-5, "steps": ["step1", "step2"] }`,
              user: reflection.reflections.join(" "),
              schema: GoalSchema,
              temperature: 0.8,
              maxTokens: 300,
            });
            await supabase.from("goals").insert({
              agent_id: agent.id, description: goal.description, priority: goal.priority,
              status: "active", steps: goal.steps, created_at_tick: newTick, completed_at_tick: null,
            });
          }
        }
      } catch { /* non-fatal */ }
    }));
  }

  // ── Advance simulation state ──────────────────────────────────────────────
  const { error: stateErr } = await supabase.from("simulation_state")
    .update({ current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay })
    .eq("id", sim.id);
  if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 });

  // ── Return fresh data ─────────────────────────────────────────────────────
  const { data: freshAgents } = await supabase.from("agents")
    .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping, action_emoji, action_description, hunger, energy, current_activity_verb, current_activity_target")
    .order("name");

  return NextResponse.json({
    state: { ...sim, current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay },
    agents: freshAgents ?? [],
    memoriesAdded: newMemories.length,
    conversations: convoSummaries,
    agentChatRequests,
  });
}
