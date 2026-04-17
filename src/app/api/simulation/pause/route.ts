import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/simulation/pause
 * Body: { paused: boolean }
 * Sets the simulation_state.is_paused flag on the singleton row.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const paused = typeof body?.paused === "boolean" ? body.paused : null;
  if (paused === null) {
    return NextResponse.json({ error: "Missing body: { paused: boolean }" }, { status: 400 });
  }

  const supabase = serverClient();
  const { data: sim, error: readErr } = await supabase
    .from("simulation_state")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!sim) return NextResponse.json({ error: "World not initialized" }, { status: 409 });

  const { error: updateErr } = await supabase
    .from("simulation_state")
    .update({ is_paused: paused })
    .eq("id", sim.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, paused });
}
