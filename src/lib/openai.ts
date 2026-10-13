import OpenAI from "openai";
import { z, type ZodTypeAny } from "zod";

// Model constants. The defaults target the GPT-5.4 family — cheaper-per-token
// AND smarter at instruction-following than the gpt-4-turbo / 4o-mini pair we
// used previously. Override via env for budget/testing.
export const MODEL_HIGH  = process.env.OPENAI_MODEL_HIGH  ?? "gpt-5.4-mini-2026-03-17";
export const MODEL_LOW   = process.env.OPENAI_MODEL_LOW   ?? "gpt-5.4-nano-2026-03-17";
export const MODEL_EMBED = process.env.OPENAI_MODEL_EMBED ?? "text-embedding-3-small";

/**
 * GPT-5.x and the o-series reasoning models replaced the legacy `max_tokens`
 * parameter with `max_completion_tokens`. Older models (gpt-4-turbo, 4o-mini)
 * still expect the legacy name. Detect by model id prefix.
 */
function isNewTokenParam(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model);
}

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
  // Build the request object dynamically so we send the right token parameter
  // for the model family. eslint-disable cast is intentional — the OpenAI SDK's
  // typed union doesn't accept the alternate field cleanly.
  const req: Record<string, unknown> = {
    model: opts.model,
    temperature: opts.temperature ?? 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  if (opts.maxTokens !== undefined) {
    if (isNewTokenParam(opts.model)) req.max_completion_tokens = opts.maxTokens;
    else                              req.max_tokens             = opts.maxTokens;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await openai().chat.completions.create(req as any);

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
  chosen_action: z.enum([
    "move_to", "idle", "go_home", "talk_to",
    // Physical activities at world objects. Each needs a target_object that
    // resolves to an InteractableObject of the matching verb. The action
    // ALSO works if target_object is null — the engine will pick the
    // nearest valid object automatically.
    // `bake` is role-locked (only the baker can use the oven); everyone else
    // who picks it will be rejected by the engine and fall back to idle.
    "eat", "sleep", "rest", "pray", "read", "forage", "bake",
  ]),
  target_building: z.string().nullish().default(null),
  target_agent: z.string().nullish().default(null),
  // Required for the physical-activity verbs; ignored for the movement ones.
  target_object: z.string().nullish().default(null),
  // Caps are deliberately roomy — newer models occasionally produce slightly
  // longer outputs, and we'd rather accept a workable decision than reject it.
  reasoning: z.string().max(400),
  // Present-tense description of what the agent is doing, e.g. "Thomas is wiping down the bar"
  action_description: z.string().max(280).default(""),
  // 1–3 emojis representing the action, e.g. "🍺✨" — emoji codepoints eat chars fast
  action_emoji: z.string().max(24).default(""),
  // 1-based indices into the active-goals list shown in the prompt. The LLM
  // marks any goals it has just fulfilled (e.g. "had lunch at the inn"
  // completes the "have lunch with Brynn" goal). Lets goals actually retire
  // instead of accumulating forever.
  completed_goal_indices: z.array(z.number().int().min(1)).default([]),
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
  thought: z.string().max(400),
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
  relationship_note: z.string().max(400),
});

// Schema for the Chunk-2 backstory generation call
export const BackstorySchema = z.object({
  backstory: z.string().min(50),
});

// Schema for Chunk-6 goal formation
export const GoalSchema = z.object({
  description: z.string().max(400),
  priority: z.number().min(1).max(5).int(),
  steps: z.array(z.string().max(200)).max(5),
});

// Schema for extracting commitments/plans made during a conversation.
// agentA_goal / agentB_goal are null if that agent made no concrete commitment.
const CommitmentGoalSchema = z.object({
  description: z.string().max(400),
  steps: z.array(z.string().max(200)).max(3),
  priority: z.number().min(1).max(5).int(),
});
export const ConversationCommitmentsSchema = z.object({
  agentA_goal: CommitmentGoalSchema.nullable(),
  agentB_goal: CommitmentGoalSchema.nullable(),
});
