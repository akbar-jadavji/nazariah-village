import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { z } from "zod";
import { openai, MODEL_LOW, callJSON } from "@/lib/openai";
import { generateTileMap } from "@/data/tilemap";
import { findPath } from "@/engine/pathfinding";
import { BUILDING_ID_TO_KEY } from "@/engine/buildings";

export const runtime = "nodejs";

// All buildings the LLM can choose from (mirrors the list in tick/route.ts).
const ALL_BUILDING_KEYS =
  "inn, library, bakery, workshop, apothecary, plaza, park, " +
  "cottage_1, cottage_2, cottage_3, cottage_4, cottage_5, " +
  "cottage_6, cottage_7, cottage_8, cottage_9, cottage_10";

// Generated once per module load — tilemap is pure / static.
const TILEMAP = generateTileMap();

type HistoryMessage = { role: "user" | "assistant"; content: string };

// Reserved UUID that stands in for "the player" in relationships +
// conversations.agent_b_id. Real agents will never have this UUID.
const PLAYER_TARGET_ID = "00000000-0000-0000-0000-000000000000";

// gpt-5.x / o-series models use max_completion_tokens; legacy 4-family uses
// max_tokens. Same check as src/lib/openai.ts callJSON.
function isNewTokenParam(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

/**
 * Single LLM call that does the work of three: post-chat sentiment delta,
 * importance scoring, and commitment extraction. Combining them is faster,
 * cheaper, and gives the model unified context to weight things consistently.
 */
const PlayerChatAnalysisSchema = z.object({
  // How the agent's feelings toward the player shifted this exchange.
  sentiment_delta: z.number().min(-0.3).max(0.3),
  // Short one-liner describing what happened, used to refresh the
  // relationship summary every 5 interactions (parity with agent-agent).
  relationship_note: z.string().max(400),
  // 1-10 poignancy scale (mundane → life-changing), divided by 10 on storage.
  importance: z.number().min(1).max(10),
  // Optional concrete commitment the agent made (e.g. "show the player the
  // forge tomorrow morning"). null if no commitment.
  commitment: z.object({
    description: z.string().max(400),
    priority: z.number().min(1).max(5).int(),
    steps: z.array(z.string().max(200)).max(3),
  }).nullable(),
  // Optional immediate physical action the agent should take RIGHT NOW based
  // on what they just said. This is what makes "I'll take you to the plaza"
  // actually move the agent — without it, the agent stays on her current
  // routine and the promise is just words.
  immediate_action: z.object({
    kind: z.enum(["go_to_building"]),
    target_building: z.string(),
    // Short narrative that will overwrite the agent's action_description so
    // their head-bubble matches what they just promised.
    action_description: z.string().max(280),
    action_emoji: z.string().max(24).default("🚶"),
  }).nullable(),
});

async function storePlayerInteraction(
  agentId: string,
  agentName: string,
  playerName: string,
  playerMessage: string,
  agentResponse: string,
  history: HistoryMessage[],
  supabase: ReturnType<typeof serverClient>,
) {
  const stateRes = await supabase
    .from("simulation_state")
    .select("current_tick")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tick = stateRes.data?.current_tick ?? 0;
  const now = new Date().toISOString();

  // Full transcript — earlier turns are essential context. Without them the
  // analyzer can't extract a target like "Starfall plaza" when it was named
  // in turn 1 and the latest turn just says "yeah, let's go".
  const fullTranscript = [
    ...history.slice(-10).map((h) => `${h.role === "user" ? playerName : agentName}: "${h.content}"`),
    `${playerName}: "${playerMessage}"`,
    `${agentName}: "${agentResponse}"`,
  ].join("\n");

  // ── 1. Combined post-chat analysis (1 LLM call) ────────────────────────
  let analysis: z.infer<typeof PlayerChatAnalysisSchema> | null = null;
  try {
    analysis = await callJSON({
      model: MODEL_LOW,
      system: `You analyze a single back-and-forth between a fantasy village character (${agentName}) and a visiting player (${playerName}). Output JSON only.

You produce:
  - sentiment_delta: float in [-0.3, 0.3]. How ${agentName}'s feelings toward ${playerName} shifted (warm exchange = positive, dismissive/rude = negative, neutral small talk = near zero).
  - relationship_note: one sentence describing what just happened between them.
  - importance: integer 1-10. 1 = utterly mundane chat; 10 = a life-defining moment for ${agentName} (a revelation, deep emotional bond, betrayal, etc.).
  - commitment: a concrete actionable promise ${agentName} made ("I'll meet you at the forge tomorrow"), or null. Vague pleasantries are NOT commitments.
  - immediate_action: if ${agentName} JUST said they would do something physically RIGHT NOW — like "I'll take you there", "let me show you", "follow me", "I'll come with you", "let me walk you over" — return go_to_building with the target. Otherwise null.
      target_building MUST be one of: ${ALL_BUILDING_KEYS}.
      Match natural-language place names to keys (e.g. "Starfall plaza" → "plaza", "the forge" / "workshop" → "workshop", "Hearthstone Bakery" → "bakery", "Eldergrove Park" → "park", "Moonpetal Apothecary" → "apothecary", "Gilded Quill" / "library" → "library", "the inn" / "Enchanted Hearth" → "inn"). If no real-world building maps, return null.
      action_description: one present-tense sentence about what ${agentName} is doing (e.g. "${agentName} leads ${playerName} toward Starfall Plaza, glancing back to keep them in sight").
      action_emoji: 1-3 emojis (🚶✨, 🚶‍♀️🌟, 🏛️🚶, etc.).`,
      user: `Full conversation transcript (most recent at the bottom):\n${fullTranscript}\n\nFocus your analysis on what just changed in the LAST exchange, but use earlier turns for context — especially for resolving pronouns and place names. If the player asked to go to a place earlier in the chat and ${agentName} now agrees to lead them, treat that as immediate_action go_to_building with the place named earlier.`,
      schema: PlayerChatAnalysisSchema,
      temperature: 0.2,
      maxTokens: 500,
    });
    console.log(`[player chat] ${agentName} ← ${playerName}: immediate_action=${JSON.stringify(analysis?.immediate_action)}, commitment=${analysis?.commitment ? "yes" : "no"}`);
  } catch (e) {
    console.error("[player chat] analysis failed:", (e as Error).message);
  }

  const sentimentDelta = analysis?.sentiment_delta ?? 0;
  const importance01 = Math.max(0, Math.min(1, (analysis?.importance ?? 5) / 10));
  const relationshipNote = analysis?.relationship_note ?? null;

  // ── 2. Fetch existing player relationship to compute deltas ────────────
  const relRes = await supabase
    .from("relationships")
    .select("familiarity, sentiment, interaction_count, summary")
    .eq("agent_id", agentId)
    .eq("target_id", PLAYER_TARGET_ID)
    .maybeSingle();
  const existing = relRes.data;
  const newCount = (existing?.interaction_count ?? 0) + 1;

  // Re-summarise every 5 interactions, same cadence as agent-agent.
  const summary = newCount % 5 === 0 && relationshipNote
    ? relationshipNote
    : (existing?.summary ?? `${playerName} is a newcomer to the village.`);

  // ── 3. Persist memory, conversation row, relationship — in parallel ────
  const conversationContent = `I spoke with ${playerName} (the village visitor). They said: "${playerMessage.slice(0, 200)}". I told them: "${agentResponse.slice(0, 200)}"`;

  await Promise.all([
    // Conversation memory (importance now LLM-scored, not hardcoded 0.7)
    supabase.from("memories").insert({
      agent_id: agentId,
      sim_tick: tick,
      type: "conversation",
      content: conversationContent,
      embedding: null,
      importance: importance01,
      last_accessed: now,
      access_count: 0,
    }),
    // Conversation transcript row — same shape as agent-agent, except
    // agent_b_id is NULL and player_name carries the partner label so the
    // inspector's history panel can render this row alongside the others.
    supabase.from("conversations").insert({
      agent_a_id: agentId,
      agent_b_id: null,
      player_name: playerName,
      sim_tick: tick,
      turns: [
        { speaker: playerName, speakerId: PLAYER_TARGET_ID, line: playerMessage, thought: "" },
        { speaker: agentName, speakerId: agentId, line: agentResponse, thought: "" },
      ],
    }),
    // Relationship upsert — familiarity +0.05, sentiment shifts by LLM delta,
    // summary refreshes every 5 interactions, target_name_override lets the
    // inspector show the player's actual name on the relationship row.
    supabase.from("relationships").upsert(
      {
        agent_id: agentId,
        target_id: PLAYER_TARGET_ID,
        target_name_override: playerName,
        familiarity: Math.min(1, (existing?.familiarity ?? 0) + 0.05),
        sentiment: Math.max(-1, Math.min(1, (existing?.sentiment ?? 0) + sentimentDelta)),
        summary,
        last_interaction_tick: tick,
        interaction_count: newCount,
      },
      { onConflict: "agent_id,target_id" },
    ),
  ]);

  // ── 4. Immediate action — actually MOVE the agent if they just promised
  //         to "take you there" / "show you" / "let's go". Without this the
  //         chat is just nice words; the agent stays on their current routine
  //         until next tick and may never act on the goal at all.
  if (analysis?.immediate_action?.target_building) {
    const targetKey = analysis.immediate_action.target_building;
    const target = TILEMAP.buildingEntries.find(
      (b) => BUILDING_ID_TO_KEY[b.id] === targetKey,
    );
    if (!target) {
      console.warn(`[player chat] immediate_action target_building "${targetKey}" is not a recognised building key — skipping path.`);
    } else {
      const { data: agentPos } = await supabase
        .from("agents")
        .select("current_x, current_y")
        .eq("id", agentId)
        .maybeSingle();
      if (!agentPos) {
        console.warn(`[player chat] could not load position for ${agentName} — skipping path.`);
      } else {
        const path = findPath(
          { x: agentPos.current_x, y: agentPos.current_y },
          { x: target.entryX, y: target.entryY },
          TILEMAP.width, TILEMAP.height,
          (x, y) => TILEMAP.collision[y][x] === 1,
        );
        if (!path || path.length === 0) {
          console.warn(`[player chat] no path from (${agentPos.current_x},${agentPos.current_y}) to ${target.name} (${target.entryX},${target.entryY}).`);
        } else {
          // Force the agent into walking mode. next_decision_tick is pushed
          // out far enough to let the walk complete before they re-decide;
          // the move loop progresses them along path each move tick.
          await supabase.from("agents").update({
            path,
            status: "walking",
            action_description: analysis.immediate_action.action_description,
            action_emoji: analysis.immediate_action.action_emoji,
            next_decision_tick: tick + Math.max(2, path.length),
          }).eq("id", agentId);
          console.log(`[player chat] ${agentName} now walking to ${target.name} (${path.length} tiles).`);
        }
      }
    }
  }

  // ── 5. Commitment → goal (same as agent-agent path) ────────────────────
  if (analysis?.commitment) {
    await supabase.from("goals").insert({
      agent_id: agentId,
      description: analysis.commitment.description,
      priority: analysis.commitment.priority,
      status: "active",
      steps: analysis.commitment.steps,
      created_at_tick: tick,
      completed_at_tick: null,
    });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    message?: string;
    playerName?: string;
    history?: HistoryMessage[];
  };
  const { message, playerName = "Wanderer", history = [] } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const supabase = serverClient();

  // Note the relationship lookup now uses the nil-UUID, so it'll actually find
  // the row instead of silently 22P02-ing on an invalid UUID like before.
  const [agentRes, memoriesRes, relRes, stateRes] = await Promise.all([
    supabase.from("agents").select("name, backstory, traits").eq("id", id).single(),
    supabase
      .from("memories")
      .select("content, sim_tick")
      .eq("agent_id", id)
      .in("type", ["conversation", "reflection"])
      .order("sim_tick", { ascending: false })
      .limit(8),
    supabase
      .from("relationships")
      .select("familiarity, sentiment, summary, interaction_count")
      .eq("agent_id", id)
      .eq("target_id", PLAYER_TARGET_ID)
      .maybeSingle(),
    supabase
      .from("simulation_state")
      .select("time_of_day, current_day")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (agentRes.error || !agentRes.data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = agentRes.data;
  const rel = relRes.data;
  const timeOfDay = stateRes.data?.time_of_day ?? "morning";
  const day = stateRes.data?.current_day ?? 1;

  const famDesc =
    !rel || rel.interaction_count === 0
      ? `${playerName} is a stranger you have just met.`
      : rel.familiarity < 0.3
        ? `You have briefly met ${playerName} before.`
        : rel.familiarity < 0.6
          ? `You know ${playerName} a little.`
          : `You know ${playerName} fairly well.`;

  const sentDesc =
    !rel ? ""
    : rel.sentiment < -0.3 ? " You have some reservations about them."
    : rel.sentiment > 0.3 ? " You feel warmly toward them."
    : "";

  const relSummary = rel?.summary
    ? `\nHistory with ${playerName}: ${rel.summary}`
    : "";

  const playerMemories = (memoriesRes.data ?? [])
    .filter((m) => m.content.toLowerCase().includes(playerName.toLowerCase()))
    .slice(0, 4)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const memContext = playerMemories
    ? `\nYour memories involving ${playerName}:\n${playerMemories}`
    : "";

  const system = `You are ${agent.name}, a character in a fantasy village simulation.
Backstory: ${agent.backstory}
Personality traits: ${agent.traits.join(", ")}.
It is ${timeOfDay} on Day ${day}.
You are speaking directly with ${playerName}, a newcomer to the village. ${famDesc}${sentDesc}${relSummary}${memContext}
Stay in character at all times. Speak naturally and concisely (2–4 sentences). Reference your memories and surroundings, not unvisited places or incorrect times of day. Do not reveal that you are an AI.
Respond only with your spoken dialogue — no narration or stage directions.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  // Build the streaming request shape conditionally — gpt-5.x rejects the
  // legacy max_tokens param and demands max_completion_tokens instead.
  const baseReq: Record<string, unknown> = {
    model: MODEL_LOW,
    messages,
    stream: true,
    temperature: 0.85,
  };
  if (isNewTokenParam(MODEL_LOW)) baseReq.max_completion_tokens = 400;
  else                              baseReq.max_tokens             = 400;

  let streamResponse;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamResponse = await openai().chat.completions.create(baseReq as any);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of streamResponse as any) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            fullText += text;
            controller.enqueue(encoder.encode(text));
          }
        }
      } finally {
        controller.close();
        if (fullText) {
          storePlayerInteraction(id, agent.name, playerName, message, fullText, history, supabase).catch(
            (e) => console.error("player interaction store failed:", e),
          );
        }
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
