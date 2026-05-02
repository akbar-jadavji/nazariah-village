import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import seeds from "@/data/agent-seeds.json";

type Seed = {
  name: string;
  backstory: string;
  traits: string[];
  spriteColor: string;
  homeCottage: string;
  startX: number;
  startY: number;
};

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  const supabase = serverClient();

  const { count, error: countErr } = await supabase
    .from("agents")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    return NextResponse.json({ error: `DB read failed: ${countErr.message}` }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "World already initialized. Call /api/world/reset first to rebuild." },
      { status: 409 },
    );
  }

  const typedSeeds = seeds as Seed[];
  const rows = typedSeeds.map((s) => ({
    name: s.name,
    backstory: s.backstory,
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
    return NextResponse.json({ error: `Agent insert failed: ${insertErr.message}` }, { status: 500 });
  }

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
