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
  // One of: "move_to" | "idle" | "go_home"
  // talk_to added in Chunk 5.
  chosen_action: z.enum(["move_to", "idle", "go_home"]),
  // For move_to: the building key to head toward ("inn", "library", "bakery",
  // "workshop", "apothecary", "park", "plaza", "cottage_1"…"cottage_5"),
  // or null to wander freely.  Ignored for idle / go_home.
  target_building: z.string().nullable(),
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

// Schema for the Chunk-2 backstory generation call
export const BackstorySchema = z.object({
  backstory: z.string().min(50),
});
