import { NextResponse } from "next/server";
import { serverClient, AgentRow } from "@/lib/supabase";
import { generateTileMap } from "@/data/tilemap";
import { findPath } from "@/engine/pathfinding";
import { BUILDING_ID_TO_KEY, ENTERABLE_BUILDING_IDS } from "@/engine/buildings";
import {
  callJSON, embed,
  MODEL_HIGH, MODEL_LOW,
  ActionDecisionSchema, ImportanceScoresSchema, InternalThoughtSchema,
  ReflectionSchema, GoalSchema,
} from "@/lib/openai";
import { runConversation, RelationshipSnap } from "@/engine/conversation";
import { TileMap } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TICKS_PER_DAY = 96;
const OBSERVATION_RADIUS = 6; // tiles — agents perceive others within this range
const TALK_RADIUS = 3;         // tiles — max distance to initiate conversation
const MEMORY_RETRIEVE_COUNT = 30; // top-N by cosine similarity before re-ranking
const MEMORY_CONTEXT_COUNT = 10; // final top-N fed into decision prompt
const INTERNAL_THOUGHT_CHANCE = 0.25; // probability when agent is idle

// Weighted scores for memory re-ranking (must sum to ~1)
const W_RECENCY = 0.3;
const W_RELEVANCE = 0.3;
const W_IMPORTANCE = 0.4;
const RECENCY_DECAY = 0.995; // per-tick exponential decay

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

function timeOfDayForTick(tick: number):
  "morning" | "midday" | "afternoon" | "evening" | "night" {
  const h = tick % TICKS_PER_DAY;
  if (h < 20) return "morning";
  if (h < 48) return "midday";
  if (h < 64) return "afternoon";
  if (h < 80) return "evening";
  return "night";
}

/** Distance between two positions (Chebyshev, good for tile proximity). */
function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Human-readable location description for the prompt. */
function describeLocation(agent: AgentRow, tilemap: TileMap): string {
  if (agent.current_building) {
    const entry = tilemap.buildingEntries.find(
      (b) => BUILDING_ID_TO_KEY[b.id] === agent.current_building,
    );
    return entry ? `inside ${entry.name}` : `inside a building`;
  }
  // Nearest named area
  let nearest: { name: string; d: number } | null = null;
  for (const b of tilemap.buildingEntries) {
    const d = dist(agent.current_x, agent.current_y, b.entryX, b.entryY);
    if (!nearest || d < nearest.d) nearest = { name: b.name, d };
  }
  if (nearest && nearest.d <= 4) return `near ${nearest.name}`;
  return `somewhere in the village (tile ${agent.current_x},${agent.current_y})`;
}

/** Find the entry tile for a building key. */
function buildingEntry(key: string | null, tilemap: TileMap) {
  if (!key) return null;
  for (const b of tilemap.buildingEntries) {
    if (BUILDING_ID_TO_KEY[b.id] === key) return b;
  }
  return null;
}

/** Build the observation string an agent generates this decision cycle. */
function buildObservation(
  agent: AgentRow,
  allAgents: AgentRow[],
  tilemap: TileMap,
  tick: number,
  timeOfDay: string,
  day: number,
): string {
  const location = describeLocation(agent, tilemap);
  const nearby = allAgents
    .filter(
      (a) =>
        a.id !== agent.id &&
        !a.current_building &&
        dist(agent.current_x, agent.current_y, a.current_x, a.current_y) <=
          OBSERVATION_RADIUS,
    )
    .map((a) => a.name);

  const nearbyStr =
    nearby.length === 0
      ? "Nobody is nearby."
      : `Nearby: ${nearby.join(", ")}.`;

  return `[Day ${day}, ${timeOfDay}, tick ${tick}] I am ${location}. ${nearbyStr}`;
}

type MemoryRow = {
  id: string;
  sim_tick: number;
  type: string;
  content: string;
  importance: number;
  relevance: number;
};

/** Retrieve and re-rank top memories for an agent using their observation embedding. */
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
    .sort((a, b) => (b as typeof b & {score:number}).score - (a as typeof a & {score:number}).score)
    .slice(0, MEMORY_CONTEXT_COUNT);
}

/** GPT-4-turbo action decision. */
async function decideAction(
  agent: AgentRow,
  observation: string,
  memories: MemoryRow[],
  timeOfDay: string,
  day: number,
  nearbyAgentNames: string[],
): Promise<{ chosen_action: string; target_building: string | null; target_agent: string | null; reasoning: string }> {
  const memoryBlock =
    memories.length === 0
      ? "No relevant memories yet."
      : memories
          .map((m, i) => `${i + 1}. [${m.type}] ${m.content}`)
          .join("\n");

  const talkOption = nearbyAgentNames.length > 0
    ? `- talk_to: start a conversation with someone nearby. Set target_agent to their exact name. Nearby agents you could talk to: ${nearbyAgentNames.join(", ")}.`
    : "";

  const system = `You are ${agent.name}, a character in a fantasy village simulation.
Backstory: ${agent.backstory}
Personality traits: ${agent.traits.join(", ")}.
Home: ${agent.home_building_id}.
Always respond with valid JSON only.`;

  const user = `Current observation: ${observation}

Recent relevant memories:
${memoryBlock}

Available actions:
- move_to: walk to a building. Set target_building to one of: inn, library, bakery, workshop, apothecary, plaza, park, cottage_1, cottage_2, cottage_3, cottage_4, cottage_5. Set to null to wander freely.
- idle: stay put and reflect.
- go_home: return to your cottage.
${talkOption}

It is ${timeOfDay} on day ${day}. Based on your personality, backstory, and memories, decide what to do next.
Respond with JSON: { "chosen_action": "...", "target_building": "..." or null, "target_agent": "..." or null, "reasoning": "..." }`;

  return callJSON({
    model: MODEL_HIGH,
    system,
    user,
    schema: ActionDecisionSchema,
    temperature: 0.8,
    maxTokens: 220,
  });
}

/** GPT-4o-mini internal thought for idle agents. */
async function generateThought(agent: AgentRow, observation: string): Promise<string | null> {
  try {
    const result = await callJSON({
      model: MODEL_LOW,
      system: `You are ${agent.name}. Personality: ${agent.traits.join(", ")}. Write a single brief internal thought (max 100 words) in first person. Respond with JSON: { "thought": "..." }`,
      user: `Context: ${observation}\nWhat are you thinking right now?`,
      schema: InternalThoughtSchema,
      temperature: 0.9,
      maxTokens: 80,
    });
    return result.thought;
  } catch {
    return null;
  }
}

/** Batch importance scoring for a list of memory contents (GPT-4o-mini). */
async function scoreImportance(contents: string[]): Promise<number[]> {
  if (contents.length === 0) return [];
  try {
    const result = await callJSON({
      model: MODEL_LOW,
      system: `Rate the long-term significance of each memory for a village character on a scale of 0.0 to 1.0.
0.0 = trivial routine (walking down a road).
0.5 = notable event (meeting someone new, learning something).
1.0 = life-changing (witnessing something extraordinary).
Respond with JSON: { "scores": [0.0, 0.5, ...] } — one score per memory, in the same order.`,
      user: contents.map((c, i) => `${i + 1}. ${c}`).join("\n"),
      schema: ImportanceScoresSchema,
      temperature: 0.3,
      maxTokens: 100,
    });
    // Clamp and pad/trim to match length
    const scores = result.scores.map((s) => Math.max(0, Math.min(1, s)));
    while (scores.length < contents.length) scores.push(0.3);
    return scores.slice(0, contents.length);
  } catch {
    return contents.map(() => 0.3); // fallback: treat all as mildly important
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST() {
  const supabase = serverClient();
  const tilemap = generateTileMap();

  // Load state + agents (full rows needed for backstory/traits in prompts)
  const [stateRes, agentsRes] = await Promise.all([
    supabase
      .from("simulation_state")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("agents").select("*"),
  ]);

  if (stateRes.error) return NextResponse.json({ error: stateRes.error.message }, { status: 500 });
  if (agentsRes.error) return NextResponse.json({ error: agentsRes.error.message }, { status: 500 });
  if (!stateRes.data) return NextResponse.json({ error: "World not initialized" }, { status: 409 });

  const sim = stateRes.data;
  if (sim.is_paused) return NextResponse.json({ state: sim, agents: agentsRes.data, skipped: true });

  const agents = (agentsRes.data ?? []) as AgentRow[];
  const newTick = sim.current_tick + 1;
  const newDay = sim.current_day + (newTick % TICKS_PER_DAY === 0 ? 1 : 0);
  const newTimeOfDay = timeOfDayForTick(newTick);

  // ── Occupancy map ────────────────────────────────────────────────────────
  const occupancy = new Map<string, string>(); // "x,y" → agentId
  for (const a of agents) {
    if (!a.current_building) occupancy.set(`${a.current_x},${a.current_y}`, a.id);
  }
  const keyOf = (x: number, y: number) => `${x},${y}`;

  // ── Classify agents ──────────────────────────────────────────────────────
  // Agents that need a full decision cycle (no path, not currently busy/inside)
  const needsDecision = agents.filter((a) => {
    if (newTick < a.next_decision_tick) return false; // still busy
    if (a.current_building) return false; // exiting is handled separately
    if (a.path && a.path.length > 0) return false; // still walking
    return true;
  });

  // Agents inside a building whose wait is over → they just exit
  const exiting = agents.filter(
    (a) => a.current_building && newTick >= a.next_decision_tick,
  );

  // Agents actively walking → advance one step
  const walking = agents.filter(
    (a) =>
      !a.current_building &&
      a.path &&
      a.path.length > 0 &&
      newTick >= a.next_decision_tick,
  );

  // ── Night override ───────────────────────────────────────────────────────
  // At night, agents not already home skip LLM and just go home.
  const nightGoHome = newTimeOfDay === "night"
    ? needsDecision.filter((a) => a.current_building !== a.home_building_id)
    : [];
  const aiDeciders = newTimeOfDay === "night"
    ? needsDecision.filter((a) => a.current_building === a.home_building_id)
    : needsDecision;

  // ── Phase 1: Build observations ──────────────────────────────────────────
  const observations: Map<string, string> = new Map();
  for (const agent of aiDeciders) {
    observations.set(
      agent.id,
      buildObservation(agent, agents, tilemap, newTick, newTimeOfDay, newDay),
    );
  }

  // ── Phase 2: Embed observations (parallel) ───────────────────────────────
  const embeddingResults = await Promise.allSettled(
    aiDeciders.map((a) => embed(observations.get(a.id)!)),
  );

  // ── Phase 3: Retrieve memories + batch importance (parallel) ─────────────
  const [memoryResults] = await Promise.all([
    Promise.allSettled(
      aiDeciders.map((a, i) => {
        const embResult = embeddingResults[i];
        if (embResult.status !== "fulfilled") return Promise.resolve([] as MemoryRow[]);
        return retrieveMemories(a.id, embResult.value, newTick, supabase);
      }),
    ),
  ]);

  // ── Phase 4: Action decisions (parallel, allSettled) ─────────────────────
  // Build per-agent list of talkable nearby agent names
  const nearbyTalkable = new Map<string, string[]>();
  for (const agent of aiDeciders) {
    if (agent.current_building) continue;
    const nearby = agents.filter(
      (a) =>
        a.id !== agent.id &&
        !a.current_building &&
        dist(agent.current_x, agent.current_y, a.current_x, a.current_y) <= TALK_RADIUS,
    ).map((a) => a.name);
    nearbyTalkable.set(agent.id, nearby);
  }

  const decisionResults = await Promise.allSettled(
    aiDeciders.map((a, i) =>
      decideAction(
        a,
        observations.get(a.id)!,
        memoryResults[i].status === "fulfilled" ? memoryResults[i].value : [],
        newTimeOfDay,
        newDay,
        nearbyTalkable.get(a.id) ?? [],
      ),
    ),
  );

  // ── Phase 5: Internal thoughts for idle agents ────────────────────────────
  const idleAgents = aiDeciders.filter((a, i) => {
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

  // ── Phase 6: Importance scoring ───────────────────────────────────────────
  const allObservationContents = aiDeciders.map((a) => observations.get(a.id)!);
  const importanceScores = await scoreImportance(allObservationContents);

  // ── Collect new memories to store ────────────────────────────────────────
  type NewMemory = {
    agent_id: string;
    sim_tick: number;
    type: string;
    content: string;
    embedding: number[] | null;
    importance: number;
    last_accessed: string;
    access_count: number;
  };
  const newMemories: NewMemory[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < aiDeciders.length; i++) {
    const agent = aiDeciders[i];
    const content = observations.get(agent.id)!;
    const embedding = embeddingResults[i].status === "fulfilled"
      ? embeddingResults[i].value
      : null;
    newMemories.push({
      agent_id: agent.id,
      sim_tick: newTick,
      type: "observation",
      content,
      embedding,
      importance: importanceScores[i] ?? 0.3,
      last_accessed: now,
      access_count: 0,
    });
  }

  // Thoughts
  for (let i = 0; i < idleAgents.length; i++) {
    const tr = thoughtResults[i];
    if (tr.status === "fulfilled" && tr.value) {
      // Thoughts are stored without embedding for now (low priority)
      newMemories.push({
        agent_id: idleAgents[i].id,
        sim_tick: newTick,
        type: "internal_thought",
        content: tr.value,
        embedding: null,
        importance: 0.3,
        last_accessed: now,
        access_count: 0,
      });
    }
  }

  // ── Build agent updates ───────────────────────────────────────────────────
  type AgentUpdate = {
    id: string;
    current_x?: number;
    current_y?: number;
    current_building?: string | null;
    path?: { x: number; y: number }[] | null;
    next_decision_tick?: number;
    status?: string;
  };
  const updates: AgentUpdate[] = [];

  // 1. Exiting agents
  for (const agent of exiting) {
    updates.push({
      id: agent.id,
      current_building: null,
      path: null,
      next_decision_tick: newTick + 1 + rand(3),
      status: "idle",
    });
  }

  // Pre-compute which tiles walking agents will vacate this tick.
  // This resolves swap-deadlocks: if A is at tile X and B wants X, A will
  // vacate X → allow B to claim it (first-come in iteration order).
  const willVacate = new Set<string>(walking.map((a) => keyOf(a.current_x, a.current_y)));
  const claimedTiles = new Set<string>(); // prevents two agents claiming the same vacated tile

  // 2. Walking agents — advance one step
  for (const agent of walking) {
    const nextStep = agent.path![0];
    const nextKey = keyOf(nextStep.x, nextStep.y);
    const holder = occupancy.get(nextKey);

    if (holder && holder !== agent.id) {
      if (willVacate.has(nextKey) && !claimedTiles.has(nextKey)) {
        // Holder will vacate — allow this move (swap resolution).
      } else {
        // Truly blocked by a stationary agent or lost race for vacated tile.
        // Clear path so the agent re-plans next tick rather than staying stuck.
        updates.push({ id: agent.id, path: null, next_decision_tick: newTick + 1 + rand(2), status: "idle" });
        continue;
      }
    }

    claimedTiles.add(nextKey);
    occupancy.delete(keyOf(agent.current_x, agent.current_y));
    occupancy.set(nextKey, agent.id);
    const remaining = agent.path!.slice(1);

    if (remaining.length === 0) {
      // Arrived at destination
      const entry = tilemap.buildingEntries.find(
        (b) => b.entryX === nextStep.x && b.entryY === nextStep.y && ENTERABLE_BUILDING_IDS.has(b.id),
      );
      if (entry && Math.random() < 0.5) {
        occupancy.delete(nextKey);
        updates.push({
          id: agent.id,
          current_x: nextStep.x,
          current_y: nextStep.y,
          current_building: BUILDING_ID_TO_KEY[entry.id] ?? String(entry.id),
          path: null,
          next_decision_tick: newTick + 4 + rand(8),
          status: "resting",
        });
        continue;
      }
      updates.push({
        id: agent.id,
        current_x: nextStep.x,
        current_y: nextStep.y,
        path: null,
        next_decision_tick: newTick + 1 + rand(2),
        status: "idle",
      });
    } else {
      updates.push({
        id: agent.id,
        current_x: nextStep.x,
        current_y: nextStep.y,
        path: remaining,
        status: "walking",
      });
    }
  }

  // 3. Night go-home overrides (no LLM)
  for (const agent of nightGoHome) {
    const homeEntry = buildingEntry(agent.home_building_id, tilemap);
    if (!homeEntry) continue;
    const path = findPath(
      { x: agent.current_x, y: agent.current_y },
      { x: homeEntry.entryX, y: homeEntry.entryY },
      tilemap.width, tilemap.height,
      (x, y) => tilemap.collision[y][x] === 1,
    );
    if (path) {
      updates.push({ id: agent.id, path, status: "walking" });
    }
  }

  // 4. AI-decided actions
  for (let i = 0; i < aiDeciders.length; i++) {
    const agent = aiDeciders[i];
    const dr = decisionResults[i];

    // Fallback: random wander if LLM failed
    if (dr.status === "rejected") {
      let planned: { x: number; y: number }[] | null = null;
      for (let attempt = 0; attempt < 6 && !planned; attempt++) {
        const tx = 1 + rand(tilemap.width - 2);
        const ty = 1 + rand(tilemap.height - 2);
        if (tilemap.collision[ty][tx] === 1) continue;
        planned = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: tx, y: ty },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
      }
      if (planned) updates.push({ id: agent.id, path: planned, status: "walking" });
      continue;
    }

    const decision = dr.value;

    if (decision.chosen_action === "idle") {
      updates.push({
        id: agent.id,
        path: null,
        next_decision_tick: newTick + 3 + rand(4),
        status: "thinking",
      });
      continue;
    }

    if (decision.chosen_action === "go_home") {
      const homeEntry = buildingEntry(agent.home_building_id, tilemap);
      if (homeEntry) {
        const path = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: homeEntry.entryX, y: homeEntry.entryY },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
        if (path) updates.push({ id: agent.id, path, status: "walking" });
      }
      continue;
    }

    // talk_to — handled in conversation pipeline below; mark as "talking" for now
    if (decision.chosen_action === "talk_to") {
      // Will be resolved in conversation pipeline. Hold the agent in place.
      updates.push({
        id: agent.id,
        path: null,
        next_decision_tick: newTick + 1,
        status: "talking",
      });
      continue;
    }

    // move_to
    if (decision.chosen_action === "move_to") {
      const target = buildingEntry(decision.target_building ?? null, tilemap);
      if (target) {
        const path = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: target.entryX, y: target.entryY },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
        if (path) {
          updates.push({ id: agent.id, path, status: "walking" });
          continue;
        }
      }
      // No valid building target or path failed — random wander fallback
      let planned: { x: number; y: number }[] | null = null;
      for (let attempt = 0; attempt < 6 && !planned; attempt++) {
        const tx = 1 + rand(tilemap.width - 2);
        const ty = 1 + rand(tilemap.height - 2);
        if (tilemap.collision[ty][tx] === 1) continue;
        planned = findPath(
          { x: agent.current_x, y: agent.current_y },
          { x: tx, y: ty },
          tilemap.width, tilemap.height,
          (x, y) => tilemap.collision[y][x] === 1,
        );
      }
      if (planned) updates.push({ id: agent.id, path: planned, status: "walking" });
    }
  }

  // ── Conversation pipeline ────────────────────────────────────────────────
  // Match agents who decided to talk_to someone valid and nearby.
  const agentById = new Map(agents.map((a) => [a.id, a]));
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
    if (dr.status !== "fulfilled") continue;
    if (dr.value.chosen_action !== "talk_to") continue;
    if (inConversation.has(agent.id)) continue;

    const targetName = dr.value.target_agent;
    if (!targetName) continue;
    const target = agentByName.get(targetName);
    if (!target || inConversation.has(target.id)) continue;
    if (target.current_building) continue;
    if (dist(agent.current_x, agent.current_y, target.current_x, target.current_y) > TALK_RADIUS) continue;

    // Fetch relationships
    const [relAB, relBA] = await Promise.all([
      supabase.from("relationships").select("*")
        .eq("agent_id", agent.id).eq("target_id", target.id).maybeSingle(),
      supabase.from("relationships").select("*")
        .eq("agent_id", target.id).eq("target_id", agent.id).maybeSingle(),
    ]);

    // Fetch last 3 conversation memories for each agent mentioning the other
    const [memARes, memBRes] = await Promise.all([
      supabase.from("memories").select("content")
        .eq("agent_id", agent.id).eq("type", "conversation")
        .order("sim_tick", { ascending: false }).limit(3),
      supabase.from("memories").select("content")
        .eq("agent_id", target.id).eq("type", "conversation")
        .order("sim_tick", { ascending: false }).limit(3),
    ]);

    inConversation.add(agent.id);
    inConversation.add(target.id);

    const snap = (row: typeof relAB.data): RelationshipSnap | null =>
      row ? { familiarity: row.familiarity, sentiment: row.sentiment,
               summary: row.summary, interaction_count: row.interaction_count } : null;

    convoPairs.push({
      agentA: agent, agentB: target,
      relAtoB: snap(relAB.data), relBtoA: snap(relBA.data),
      memsA: (memARes.data ?? []).map((m) => m.content),
      memsB: (memBRes.data ?? []).map((m) => m.content),
      location: describeLocation(agent, tilemap),
    });
  }

  // Run all conversations in parallel (allSettled)
  type ConvoResult = { agentA: AgentRow; agentB: AgentRow; result: Awaited<ReturnType<typeof runConversation>> };
  const convoSettled = await Promise.allSettled(
    convoPairs.map(async (p): Promise<ConvoResult> => ({
      agentA: p.agentA,
      agentB: p.agentB,
      result: await runConversation(p.agentA, p.agentB, p.relAtoB, p.relBtoA, p.memsA, p.memsB, p.location),
    })),
  );

  // Collect conversation outcomes for DB writes + tick response
  type ConvoTurn = { speaker: string; speakerId: string; line: string; thought: string };
  const convoSummaries: { agentAId: string; agentBId: string; agentAName: string; agentBName: string; turns: ConvoTurn[] }[] = [];
  const now2 = new Date().toISOString();

  for (const settled of convoSettled) {
    if (settled.status === "rejected") {
      console.error("Conversation failed:", settled.reason);
      continue;
    }
    const { agentA, agentB, result } = settled.value;

    // Store conversation log
    const convoInsert = await supabase.from("conversations").insert({
      agent_a_id: agentA.id, agent_b_id: agentB.id,
      sim_tick: newTick, turns: result.turns,
    }).select("id").single();

    convoSummaries.push({
      agentAId: agentA.id, agentBId: agentB.id,
      agentAName: agentA.name, agentBName: agentB.name,
      turns: result.turns,
    });

    // Store conversation memories for both agents
    newMemories.push(
      { agent_id: agentA.id, sim_tick: newTick, type: "conversation",
        content: result.memoryA, embedding: null, importance: result.importance[0],
        last_accessed: now2, access_count: 0 },
      { agent_id: agentB.id, sim_tick: newTick, type: "conversation",
        content: result.memoryB, embedding: null, importance: result.importance[1],
        last_accessed: now2, access_count: 0 },
    );

    // Upsert relationships for both directions
    const upsertRel = async (agentId: string, targetId: string, sentDelta: number, existingRel: RelationshipSnap | null) => {
      const newFamiliarity = Math.min(1, (existingRel?.familiarity ?? 0) + 0.05);
      const newSentiment = Math.max(-1, Math.min(1, (existingRel?.sentiment ?? 0) + sentDelta));
      const newCount = (existingRel?.interaction_count ?? 0) + 1;

      // Every 5 interactions, regenerate summary
      let newSummary = existingRel?.summary ?? null;
      if (newCount % 5 === 0) {
        newSummary = result.relationshipNote;
      }

      await supabase.from("relationships").upsert({
        agent_id: agentId, target_id: targetId,
        familiarity: newFamiliarity, sentiment: newSentiment,
        summary: newSummary, last_interaction_tick: newTick,
        interaction_count: newCount,
      }, { onConflict: "agent_id,target_id" });
    };

    await Promise.all([
      upsertRel(agentA.id, agentB.id, result.sentimentDeltaA,
        convoPairs.find(p => p.agentA.id === agentA.id && p.agentB.id === agentB.id)?.relAtoB ?? null),
      upsertRel(agentB.id, agentA.id, result.sentimentDeltaB,
        convoPairs.find(p => p.agentA.id === agentA.id && p.agentB.id === agentB.id)?.relBtoA ?? null),
    ]);

    void convoInsert;
  }
  void agentById;

  // ── Persist memories ─────────────────────────────────────────────────────
  if (newMemories.length > 0) {
    const { error: memErr } = await supabase.from("memories").insert(newMemories);
    if (memErr) console.error("Memory insert error:", memErr.message);
  }

  // ── Persist agent updates ────────────────────────────────────────────────
  if (updates.length > 0) {
    const results = await Promise.all(
      updates.map(({ id, ...rest }) =>
        supabase.from("agents").update(rest).eq("id", id),
      ),
    );
    const firstErr = results.find((r) => r.error)?.error;
    if (firstErr) {
      return NextResponse.json(
        { error: `Agent update failed: ${firstErr.message}` },
        { status: 500 },
      );
    }
  }

  // ── Periodic reflections + goal formation ────────────────────────────
  // Every 20 ticks, up to 2 agents synthesise recent memories into a
  // reflection and optionally form a new goal.
  const REFLECTION_EVERY = 20;
  if (newTick % REFLECTION_EVERY === 0 && agents.length > 0) {
    const candidates = agents
      .filter((a) => !a.current_building)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);

    await Promise.allSettled(
      candidates.map(async (agent) => {
        try {
          const { data: mems } = await supabase
            .from("memories")
            .select("type, content, sim_tick")
            .eq("agent_id", agent.id)
            .order("sim_tick", { ascending: false })
            .limit(12);

          if (!mems || mems.length < 4) return;

          const memText = mems
            .map((m) => `[${m.type}] ${m.content}`)
            .join("\n");

          const reflection = await callJSON({
            model: MODEL_LOW,
            system: `You are ${agent.name}. Traits: ${agent.traits.join(", ")}.
Write 1-2 reflective insights based on your recent experiences.
Respond with JSON: { "reflections": ["insight 1", "insight 2"] }`,
            user: `Recent experiences:\n${memText}`,
            schema: ReflectionSchema,
            temperature: 0.85,
            maxTokens: 200,
          });

          const reflectionText = reflection.reflections.join(" ");

          await supabase.from("memories").insert({
            agent_id: agent.id,
            sim_tick: newTick,
            type: "reflection",
            content: reflectionText,
            embedding: null,
            importance: 0.7,
            last_accessed: new Date().toISOString(),
            access_count: 0,
          });

          // 35% chance to form a new goal if none currently active
          if (Math.random() < 0.35) {
            const { data: active } = await supabase
              .from("goals")
              .select("id")
              .eq("agent_id", agent.id)
              .eq("status", "active")
              .limit(1);

            if (!active || active.length === 0) {
              const goal = await callJSON({
                model: MODEL_LOW,
                system: `You are ${agent.name}. Traits: ${agent.traits.join(", ")}.
Based on your reflection, define one concrete personal goal you want to work toward.
Respond with JSON: { "description": "...", "priority": 1-5, "steps": ["step1", "step2"] }`,
                user: `Reflection: ${reflectionText}`,
                schema: GoalSchema,
                temperature: 0.8,
                maxTokens: 150,
              });

              await supabase.from("goals").insert({
                agent_id: agent.id,
                description: goal.description,
                priority: goal.priority,
                status: "active",
                steps: goal.steps,
                created_at_tick: newTick,
                completed_at_tick: null,
              });
            }
          }
        } catch {
          // Reflection failures are non-fatal
        }
      }),
    );
  }

  // ── Update simulation_state ───────────────────────────────────────────────
  const { error: stateErr } = await supabase
    .from("simulation_state")
    .update({ current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay })
    .eq("id", sim.id);
  if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 });

  // ── Return fresh agent list ───────────────────────────────────────────────
  const { data: freshAgents } = await supabase
    .from("agents")
    .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping")
    .order("name", { ascending: true });

  return NextResponse.json({
    state: { ...sim, current_tick: newTick, current_day: newDay, time_of_day: newTimeOfDay },
    agents: freshAgents ?? [],
    memoriesAdded: newMemories.length,
    conversations: convoSummaries,
  });
}
