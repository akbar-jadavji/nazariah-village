import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { callJSON, MODEL_HIGH, BackstorySchema } from "@/lib/openai";
import seeds from "@/data/agent-seeds.json";

type Seed = {
  name: string;
  traits: string[];
  premise: string;
  spriteColor: string;
  homeCottage: string;
  startX: number;
  startY: number;
};

export const runtime = "nodejs";
// This route can take a while (up to 12 LLM calls in parallel).
// Chunk 1 deploy target is Vercel Pro (60s timeout).
export const maxDuration = 60;

async function generateBackstory(seed: Seed): Promise<string> {
  const system =
    "You write short, evocative character backstories for a fantasy village simulation. " +
    "Respond ONLY with JSON of the form { \"backstory\": string }. " +
    "The backstory is 200-300 words. Do not use markdown, headings, or lists. " +
    "Include: implicit name, approximate age, personality, brief life history, core values, and current emotional state. " +
    "Write in third person. Keep the tone warm and grounded, not epic.";

  const user = JSON.stringify({
    name: seed.name,
    traits: seed.traits,
    premise: seed.premise,
  });

  const result = await callJSON({
    model: MODEL_HIGH,
    system,
    user,
    schema: BackstorySchema,
    temperature: 0.9,
    maxTokens: 500,
  });
  return result.backstory;
}

export async function POST() {
  const supabase = serverClient();

  // Guard: do not wipe an existing world. If agents exist, return them.
  const { count, error: countErr } = await supabase
    .from("agents")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    return NextResponse.json(
      { error: `DB read failed: ${countErr.message}` },
      { status: 500 }
    );
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "World already initialized. Call /api/world/reset first to rebuild." },
      { status: 409 }
    );
  }

  // Generate all backstories in parallel (independent calls)
  const typedSeeds = seeds as Seed[];
  const backstoryResults = await Promise.allSettled(
    typedSeeds.map((s) => generateBackstory(s))
  );

  // Any failed backstory aborts init — do not write partial world state.
  const failures: { name: string; reason: string }[] = [];
  backstoryResults.forEach((r, i) => {
    if (r.status === "rejected") {
      failures.push({
        name: typedSeeds[i].name,
        reason: String(r.reason).slice(0, 200),
      });
    }
  });
  if (failures.length > 0) {
    return NextResponse.json(
      { error: "Backstory generation failed", failures },
      { status: 500 }
    );
  }

  const rows = typedSeeds.map((s, i) => ({
    name: s.name,
    backstory: (backstoryResults[i] as PromiseFulfilledResult<string>).value,
    traits: s.traits,
    sprite_key: `char:${s.spriteColor}`,
    home_building_id: s.homeCottage,
    current_x: s.startX,
    current_y: s.startY,
    current_building: null,
    status: "idle",
    is_sleeping: false,
  }));

  const { data: insertedAgents, error: insertErr } = await supabase
    .from("agents")
    .insert(rows)
    .select();
  if (insertErr) {
    return NextResponse.json(
      { error: `Agent insert failed: ${insertErr.message}` },
      { status: 500 }
    );
  }

  // Initialize simulation state if not present
  const { data: existingState } = await supabase
    .from("simulation_state")
    .select("id")
    .limit(1)
    .maybeSingle();
  if (!existingState) {
    await supabase.from("simulation_state").insert({
      current_tick: 0,
      current_day: 1,
      time_of_day: "morning",
      is_paused: false,
    });
  }

  return NextResponse.json({
    ok: true,
    count: insertedAgents?.length ?? 0,
    agents: insertedAgents,
  });
}
