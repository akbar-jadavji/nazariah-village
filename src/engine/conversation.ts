/**
 * Conversation engine (Chunk 5)
 *
 * Drives a 2–4 turn GPT-4-turbo dialogue between two agents, then:
 *  - generates a per-agent conversation memory summary (GPT-4o-mini)
 *  - scores sentiment deltas and produces a relationship note (GPT-4o-mini)
 *
 * Callers are responsible for all Supabase reads/writes — this module is
 * purely LLM orchestration and returns plain data.
 */

import {
  callJSON,
  MODEL_HIGH, MODEL_LOW,
  ConversationTurnSchema, ConversationSentimentSchema, ImportanceScoresSchema,
} from "@/lib/openai";
import { AgentRow } from "@/lib/supabase";

export type ConversationTurn = {
  speaker: string;
  speakerId: string;
  line: string;
  thought: string;
};

export type RelationshipSnap = {
  familiarity: number;
  sentiment: number;
  summary: string | null;
  interaction_count: number;
};

export type ConversationResult = {
  turns: ConversationTurn[];
  // Memory content to store for each agent (observation summary of the convo)
  memoryA: string;
  memoryB: string;
  // Sentiment change for A's view of B, and B's view of A
  sentimentDeltaA: number;
  sentimentDeltaB: number;
  // Short note about this interaction (for relationship summary)
  relationshipNote: string;
  // Importance scores: [memoryA, memoryB]
  importance: [number, number];
};

const MAX_TURNS = 4;

function buildSpeakerSystemPrompt(
  speaker: AgentRow,
  other: AgentRow,
  rel: RelationshipSnap | null,
  timeOfDay: string,
  day: number,
): string {
  const famDesc = !rel ? "You have never met them before."
    : rel.familiarity < 0.2 ? "You have barely met them."
    : rel.familiarity < 0.5 ? "You know them a little."
    : rel.familiarity < 0.8 ? "You know them fairly well."
    : "You know them very well.";

  const sentDesc = !rel ? ""
    : rel.sentiment < -0.3 ? " You have negative feelings toward them."
    : rel.sentiment > 0.3 ? " You feel warmly toward them."
    : "";

  const relSummary = rel?.summary ? `\nRelationship history: ${rel.summary}` : "";

  return `You are ${speaker.name}, a character in a fantasy village simulation.
Backstory: ${speaker.backstory}
Personality traits: ${speaker.traits.join(", ")}.
You are talking with ${other.name}. ${famDesc}${sentDesc}${relSummary}
It is currently ${timeOfDay} on Day ${day}.
Ground all dialogue strictly in your current situation and memories. Do not mention places you have not visited, events not in your memories, or an incorrect time of day.
Stay in character at all times. Keep dialogue natural and brief (1–3 sentences per turn).
Always respond with valid JSON.`;
}

export async function runConversation(
  agentA: AgentRow,
  agentB: AgentRow,
  relAtoB: RelationshipSnap | null,
  relBtoA: RelationshipSnap | null,
  recentMemoriesA: string[], // last few memory contents mentioning B
  recentMemoriesB: string[], // last few memory contents mentioning A
  location: string,
  timeOfDay: string,
  day: number,
): Promise<ConversationResult> {
  const turns: ConversationTurn[] = [];

  // Build initial context strings
  const memCtxA = recentMemoriesA.length
    ? `Your memories involving ${agentB.name}:\n${recentMemoriesA.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : `You have no prior memories involving ${agentB.name}.`;

  const memCtxB = recentMemoriesB.length
    ? `Your memories involving ${agentA.name}:\n${recentMemoriesB.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : `You have no prior memories involving ${agentA.name}.`;

  // ── Turn 1: A opens ─────────────────────────────────────────────────────
  const turn1 = await callJSON({
    model: MODEL_LOW,
    system: buildSpeakerSystemPrompt(agentA, agentB, relAtoB, timeOfDay, day),
    user: `You see ${agentB.name} at ${location}. ${memCtxA}
Start the conversation with a natural opening line grounded in your current situation.
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": false }`,
    schema: ConversationTurnSchema,
    temperature: 0.85,
    maxTokens: 150,
  });
  turns.push({ speaker: agentA.name, speakerId: agentA.id, line: turn1.dialogue_line, thought: turn1.internal_thought });

  // ── Turn 2: B responds ───────────────────────────────────────────────────
  const turn2 = await callJSON({
    model: MODEL_LOW,
    system: buildSpeakerSystemPrompt(agentB, agentA, relBtoA, timeOfDay, day),
    user: `You are at ${location}. ${memCtxB}
${agentA.name} says: "${turn1.dialogue_line}"
Respond naturally. If you want to end the conversation set end_conversation to true.
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": boolean }`,
    schema: ConversationTurnSchema,
    temperature: 0.85,
    maxTokens: 150,
  });
  turns.push({ speaker: agentB.name, speakerId: agentB.id, line: turn2.dialogue_line, thought: turn2.internal_thought });

  // ── Turns 3–4: continue if conversation isn't over ──────────────────────
  if (!turn2.end_conversation && turns.length < MAX_TURNS) {
    const turn3 = await callJSON({
      model: MODEL_LOW,
      system: buildSpeakerSystemPrompt(agentA, agentB, relAtoB, timeOfDay, day),
      user: buildContinuePrompt(agentA.name, turns, agentB.name, true),
      schema: ConversationTurnSchema,
      temperature: 0.85,
      maxTokens: 150,
    });
    turns.push({ speaker: agentA.name, speakerId: agentA.id, line: turn3.dialogue_line, thought: turn3.internal_thought });

    if (!turn3.end_conversation && turns.length < MAX_TURNS) {
      const turn4 = await callJSON({
        model: MODEL_LOW,
        system: buildSpeakerSystemPrompt(agentB, agentA, relBtoA, timeOfDay, day),
        user: buildContinuePrompt(agentB.name, turns, agentA.name, false),
        schema: ConversationTurnSchema,
        temperature: 0.85,
        maxTokens: 150,
      });
      turns.push({ speaker: agentB.name, speakerId: agentB.id, line: turn4.dialogue_line, thought: turn4.internal_thought });
    }
  }

  // ── Sentiment + relationship note (GPT-4o-mini) ──────────────────────────
  const transcript = turns.map((t) => `${t.speaker}: "${t.line}"`).join("\n");
  const sentimentResult = await callJSON({
    model: MODEL_LOW,
    system: `You analyze conversations between fantasy village characters.
Rate how each character's feelings toward the other changed during this conversation.
Respond with JSON: { "sentiment_delta_a": float (-0.3 to 0.3), "sentiment_delta_b": float (-0.3 to 0.3), "relationship_note": "one sentence describing what happened" }`,
    user: `${agentA.name} and ${agentB.name} had this conversation:\n${transcript}`,
    schema: ConversationSentimentSchema,
    temperature: 0.3,
    maxTokens: 120,
  });

  // ── Memory summaries (GPT-4o-mini) ────────────────────────────────────────
  const summaryA = `I had a conversation with ${agentB.name} at ${location}. ${sentimentResult.relationship_note} They said: "${turns.find(t => t.speakerId === agentB.id)?.line ?? "..."}"`;
  const summaryB = `I had a conversation with ${agentA.name} at ${location}. ${sentimentResult.relationship_note} They said: "${turns.find(t => t.speakerId === agentA.id)?.line ?? "..."}"`;

  // ── Importance scores for both memory entries ────────────────────────────
  let importance: [number, number] = [0.5, 0.5];
  try {
    const scores = await callJSON({
      model: MODEL_LOW,
      system: `Rate the long-term significance of each memory for a village character (0.0 trivial → 1.0 life-changing). Respond with JSON: { "scores": [float, float] }`,
      user: `1. ${summaryA}\n2. ${summaryB}`,
      schema: ImportanceScoresSchema,
      temperature: 0.3,
      maxTokens: 60,
    });
    importance = [
      Math.max(0, Math.min(1, scores.scores[0] ?? 0.5)),
      Math.max(0, Math.min(1, scores.scores[1] ?? 0.5)),
    ];
  } catch { /* keep defaults */ }

  return {
    turns,
    memoryA: summaryA,
    memoryB: summaryB,
    sentimentDeltaA: sentimentResult.sentiment_delta_a,
    sentimentDeltaB: sentimentResult.sentiment_delta_b,
    relationshipNote: sentimentResult.relationship_note,
    importance,
  };
}

function buildContinuePrompt(
  speakerName: string,
  turns: ConversationTurn[],
  otherName: string,
  speakerIsA: boolean,
): string {
  const last = turns[turns.length - 1];
  const prior = turns
    .slice(-3)
    .map((t) => `${t.speaker}: "${t.line}"`)
    .join("\n");
  void speakerIsA;
  return `Conversation so far:\n${prior}\n\n${last.speaker !== speakerName ? otherName : last.speaker} just said: "${last.line}"
Continue your response naturally. If the conversation feels complete, set end_conversation to true.
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": boolean }`;
}
