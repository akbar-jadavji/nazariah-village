import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/simulation/state — fetch current world state for the canvas.
 * Returns simulation_state + all agents (public-safe subset).
 */
export async function GET() {
  const supabase = serverClient();

  const [agentsRes, stateRes] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, sprite_key, current_x, current_y, current_building, status, is_sleeping")
      .order("name", { ascending: true }),
    supabase
      .from("simulation_state")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (agentsRes.error) {
    return NextResponse.json({ error: agentsRes.error.message }, { status: 500 });
  }
  if (stateRes.error) {
    return NextResponse.json({ error: stateRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    state: stateRes.data ?? null,
    agents: agentsRes.data ?? [],
  });
}
