/**
 * Conversation engine
 *
 * Drives a dynamic-length dialogue (2–8 turns) between two agents, then:
 *  - scores sentiment deltas and produces a relationship note (gpt-4o-mini)
 *  - builds per-agent memory summaries
 *  - scores importance of those memories (gpt-4o-mini)
 *
 * Turn flow:
 *  - A always opens (turn 0)
 *  - B must respond (turn 1)
 *  - From turn 1 onwards either party may signal end_conversation: true
 *  - When that happens the other party gets one closing turn, then the
 *    conversation ends — so no question is ever left unanswered
 *  - Hard cap: MAX_TURNS (8)
 */

import {
  callJSON,
  MODEL_LOW,
  ConversationTurnSchema, ConversationSentimentSchema, ImportanceScoresSchema,
  ConversationCommitmentsSchema, SocialEventSchema,
} from "@/lib/openai";
import { z } from "zod";
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
  last_interaction_tick?: number;
};

type CommitmentGoal = { description: string; steps: string[]; priority: number };

export type SocialEventDraft = {
  title: string;
  description: string;
  location: string;
  scheduledDayOffset: number;
  scheduledTimeOfDay: string;
  organizerIsA: boolean; // which agent is hosting
};

export type UpcomingEvent = {
  id: string;
  title: string;
  location: string;
  scheduledDay: number;
  scheduledTimeOfDay: string;
  organizerName: string;
};

export type ConversationResult = {
  turns: ConversationTurn[];
  memoryA: string;
  memoryB: string;
  sentimentDeltaA: number;
  sentimentDeltaB: number;
  relationshipNote: string;
  importance: [number, number];
  commitmentA: CommitmentGoal | null;
  commitmentB: CommitmentGoal | null;
  // Social event planned during this conversation (null = none)
  socialEvent: SocialEventDraft | null;
};

const MIN_TURNS = 2; // A opens + B responds at minimum
const MAX_TURNS = 8; // hard cap

function buildSpeakerSystemPrompt(
  speaker: AgentRow,
  other: AgentRow,
  rel: RelationshipSnap | null,
  timeOfDay: string,
  day: number,
  speakerEvents: UpcomingEvent[],
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

  const eventCtx = speakerEvents.length > 0
    ? `\nEvents you know about (feel free to mention or invite ${other.name}):\n` +
      speakerEvents.map((e) =>
        `- "${e.title}" at the ${e.location}, Day ${e.scheduledDay} ${e.scheduledTimeOfDay}` +
        (e.organizerName === speaker.name ? " (you are hosting)" : ` (organised by ${e.organizerName})`),
      ).join("\n")
    : "";

  return `You are ${speaker.name}, a character in a fantasy village simulation.
Backstory: ${speaker.backstory}
Personality traits: ${speaker.traits.join(", ")}.
You are talking with ${other.name}. ${famDesc}${sentDesc}${relSummary}
It is currently ${timeOfDay} on Day ${day}.${eventCtx}
Ground all dialogue in your current situation and memories only. Do not mention places you have not visited, events not in your memories, or an incorrect time of day.
If you know about upcoming events, it is natural to bring them up or invite ${other.name}.
Keep each line natural and brief (1–3 sentences). Match the conversational energy — if the other person is wrapping up, wrap up too.
Always respond with valid JSON.`;
}

export async function runConversation(
  agentA: AgentRow,
  agentB: AgentRow,
  relAtoB: RelationshipSnap | null,
  relBtoA: RelationshipSnap | null,
  recentMemoriesA: string[],
  recentMemoriesB: string[],
  location: string,
  timeOfDay: string,
  day: number,
  upcomingEventsA: UpcomingEvent[],
  upcomingEventsB: UpcomingEvent[],
): Promise<ConversationResult> {
  const turns: ConversationTurn[] = [];

  const memCtxA = recentMemoriesA.length
    ? `Your memories involving ${agentB.name}:\n${recentMemoriesA.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : `You have no prior memories involving ${agentB.name}.`;

  const memCtxB = recentMemoriesB.length
    ? `Your memories involving ${agentA.name}:\n${recentMemoriesB.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
    : `You have no prior memories involving ${agentA.name}.`;

  // pendingClose: the previous speaker signalled end_conversation — this turn is the wrap-up
  let pendingClose = false;

  for (let t = 0; t < MAX_TURNS; t++) {
    const isA = t % 2 === 0;
    const speaker  = isA ? agentA : agentB;
    const other    = isA ? agentB : agentA;
    const rel      = isA ? relAtoB : relBtoA;
    const memCtx   = isA ? memCtxA : memCtxB;

    const speakerEvents = isA ? upcomingEventsA : upcomingEventsB;
    let userPrompt: string;

    if (t === 0) {
      userPrompt = `You see ${other.name} at ${location}. ${memCtx}
Start the conversation with a natural opening line grounded in your current situation.
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": false }`;
    } else if (pendingClose) {
      const lastLine = turns[turns.length - 1].line;
      userPrompt = `${other.name} says: "${lastLine}"
The conversation is wrapping up. Give a brief, natural closing response — answer any open question if there was one.
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": true }`;
    } else {
      const lastLine = turns[turns.length - 1].line;
      const recentLines = turns.slice(-3).map((x) => `${x.speaker}: "${x.line}"`).join("\n");
      const canEnd = t >= MIN_TURNS;
      userPrompt = `Conversation so far:\n${recentLines}
${other.name} just said: "${lastLine}"
${memCtx}
Respond naturally.${canEnd ? " If you have said what you needed to and the conversation feels complete, set end_conversation to true." : ""}
Respond with JSON: { "dialogue_line": "...", "internal_thought": "...", "end_conversation": boolean }`;
    }

    const turn = await callJSON({
      model: MODEL_LOW,
      system: buildSpeakerSystemPrompt(speaker, other, rel, timeOfDay, day, speakerEvents),
      user: userPrompt,
      schema: ConversationTurnSchema,
      temperature: 0.85,
      maxTokens: 150,
    });

    turns.push({
      speaker: speaker.name,
      speakerId: speaker.id,
      line: turn.dialogue_line,
      thought: turn.internal_thought,
    });

    if (pendingClose) break; // wrap-up just completed

    if (turn.end_conversation && t >= MIN_TURNS - 1) {
      pendingClose = true; // let the other party close
    }
  }

  // ── Sentiment + relationship note ────────────────────────────────────────
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

  // ── Memory summaries ──────────────────────────────────────────────────────
  const summaryA = `I had a conversation with ${agentB.name} at ${location}. ${sentimentResult.relationship_note} They said: "${turns.find(t => t.speakerId === agentB.id)?.line ?? "..."}"`;
  const summaryB = `I had a conversation with ${agentA.name} at ${location}. ${sentimentResult.relationship_note} They said: "${turns.find(t => t.speakerId === agentA.id)?.line ?? "..."}"`;

  // ── Importance scores ─────────────────────────────────────────────────────
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

  // ── Commitment extraction ────────────────────────────────────────────────
  // Look for concrete plans or promises made (e.g. "let's go to the inn",
  // "I'll meet you at the bakery") and surface them as goals.
  let commitmentA: CommitmentGoal | null = null;
  let commitmentB: CommitmentGoal | null = null;
  try {
    const commitments = await callJSON({
      model: MODEL_LOW,
      system: `You extract concrete commitments or plans made during a conversation between two characters.
A commitment is a clear, actionable promise or agreement: "let's go to X", "I'll meet you at Y", "I'll help you with Z".
Vague intentions ("maybe someday", "that sounds nice") are NOT commitments.
Return null for an agent if they made no concrete commitment.
Respond with JSON: { "agentA_goal": { "description": "...", "steps": ["..."], "priority": 1-5 } | null, "agentB_goal": ... | null }`,
      user: `${agentA.name} (agentA) and ${agentB.name} (agentB) had this conversation:\n${transcript}\n\nDid either agent make a concrete commitment or plan?`,
      schema: ConversationCommitmentsSchema,
      temperature: 0.2,
      maxTokens: 200,
    });
    commitmentA = commitments.agentA_goal ?? null;
    commitmentB = commitments.agentB_goal ?? null;
  } catch { /* non-fatal */ }

  // ── Social event extraction ──────────────────────────────────────────────
  // Did the agents plan a gathering that others could attend?
  let socialEvent: SocialEventDraft | null = null;
  try {
    const NullableEventSchema = z.object({
      event: SocialEventSchema.nullable(),
      organizer: z.enum(["agentA", "agentB", "neither"]),
    });
    const extracted = await callJSON({
      model: MODEL_LOW,
      system: `Analyse this conversation for a social event — a gathering, party, meetup, or celebration with a specific time and place that others could attend.
Only extract if the conversation contains a clear event plan (e.g. "birthday party at the inn on Day 5 evening", "morning meetup at the plaza tomorrow").
Casual suggestions without commitment ("we should hang out sometime") do NOT count.
Return event: null if no concrete event was planned.
Respond with JSON: { "event": { "title": "...", "description": "...", "location": "inn|library|bakery|workshop|apothecary|plaza|park", "scheduled_day_offset": 0-7, "scheduled_time_of_day": "morning|midday|afternoon|evening" } | null, "organizer": "agentA"|"agentB"|"neither" }`,
      user: `${agentA.name} (agentA) and ${agentB.name} (agentB) on Day ${day} (${timeOfDay}):\n${transcript}`,
      schema: NullableEventSchema,
      temperature: 0.2,
      maxTokens: 200,
    });
    if (extracted.event && extracted.organizer !== "neither") {
      socialEvent = {
        ...extracted.event,
        scheduledDayOffset: extracted.event.scheduled_day_offset,
        scheduledTimeOfDay: extracted.event.scheduled_time_of_day,
        organizerIsA: extracted.organizer === "agentA",
      };
    }
  } catch { /* non-fatal */ }

  return {
    turns,
    memoryA: summaryA,
    memoryB: summaryB,
    sentimentDeltaA: sentimentResult.sentiment_delta_a,
    sentimentDeltaB: sentimentResult.sentiment_delta_b,
    relationshipNote: sentimentResult.relationship_note,
    importance,
    commitmentA,
    commitmentB,
    socialEvent,
  };
}
