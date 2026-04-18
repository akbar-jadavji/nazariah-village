import OpenAI from "openai";
import { z, type ZodTypeAny } from "zod";

// Model constants — NEVER swap these without updating the PRD contract.
// Overridable via env for testing/budget control.
export const MODEL_HIGH = process.env.OPENAI_MODEL_HIGH ?? "gpt-4-turbo";
export const MODEL_LOW = process.env.OPENAI_MODEL_LOW ?? "gpt-4o-mini";
export const MODEL_EMBED = process.env.OPENAI_MODEL_EMBED ?? "text-embedding-3-small";

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Missing OPENAI_API_KEY in .env.local");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

/**
 * Call an LLM with JSON-mode output, then validate against a Zod schema.
 * On invalid output, throws — caller decides whether to skip the tick,
 * return an error, or retry. Never auto-repair.
 */
export async function callJSON<T extends ZodTypeAny>(opts: {
  model: string;
  system: string;
  user: string;
  schema: T;
  temperature?: number;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const resp = await openai().chat.completions.create({
    model: opts.model,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  });

  const raw = resp.choices[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `LLM output failed schema validation: ${JSON.stringify(result.error.issues).slice(0, 400)}`
    );
  }
  return result.data;
}

/** Generate an embedding for a text string. */
export async function embed(text: string): Promise<number[]> {
  const resp = await openai().embeddings.create({
    model: MODEL_EMBED,
    input: text,
  });
  const vec = resp.data[0]?.embedding;
  if (!vec) throw new Error("Embedding API returned empty result");
  return vec;
}

// -----------------------------------------------------------
// Zod schemas for the GPT output contracts defined in prd.md
// -----------------------------------------------------------

export const ActionDecisionSchema = z.object({
  // Supported: "move_to" | "idle" | "go_home" | "talk_to"
  chosen_action: z.enum(["move_to", "idle", "go_home", "talk_to"]),
  // For move_to: building key ("inn", "library", "bakery", "workshop",
  // "apothecary", "park", "plaza", "cottage_1"…"cottage_5"), or null.
  target_building: z.string().nullish().default(null),
  // For talk_to: exact name of the nearby agent to approach and talk to.
  // Null for all other actions.
  target_agent: z.string().nullish().default(null),
  reasoning: z.string().max(300),
});

export const ConversationTurnSchema = z.object({
  dialogue_line: z.string(),
  internal_thought: z.string(),
  end_conversation: z.boolean(),
});

export const ReflectionSchema = z.object({
  reflections: z.array(z.string()),
});

export const ImportanceScoresSchema = z.object({
  scores: z.array(z.number()),
});

// Schema for a single internal thought (Chunk 4)
export const InternalThoughtSchema = z.object({
  thought: z.string().max(200),
});

// Schema for a single conversation turn (Chunk 5)
// ConversationTurnSchema already exported above — re-used here.

// Schema for post-conversation sentiment analysis (Chunk 5)
export const ConversationSentimentSchema = z.object({
  // How much A's sentiment toward B changed this conversation (-0.3 to +0.3)
  sentiment_delta_a: z.number().min(-0.3).max(0.3),
  // How much B's sentiment toward A changed this conversation (-0.3 to +0.3)
  sentiment_delta_b: z.number().min(-0.3).max(0.3),
  // One-line summary of the conversation for relationship records
  relationship_note: z.string().max(200),
});

// Schema for the Chunk-2 backstory generation call
export const BackstorySchema = z.object({
  backstory: z.string().min(50),
});

// Schema for Chunk-6 goal formation
export const GoalSchema = z.object({
  description: z.string().max(200),
  priority: z.number().min(1).max(5).int(),
  steps: z.array(z.string()).max(5),
});

// Schema for extracting commitments/plans made during a conversation.
// agentA_goal / agentB_goal are null if that agent made no concrete commitment.
const CommitmentGoalSchema = z.object({
  description: z.string().max(200),
  steps: z.array(z.string()).max(3),
  priority: z.number().min(1).max(5).int(),
});
export const ConversationCommitmentsSchema = z.object({
  agentA_goal: CommitmentGoalSchema.nullable(),
  agentB_goal: CommitmentGoalSchema.nullable(),
});
