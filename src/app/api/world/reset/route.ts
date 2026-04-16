import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Wipe all simulation data. Dev helper — no confirmation.
 * Cascades via agents FK delete agents, memories, goals, relationships.
 */
export async function POST() {
  const supabase = serverClient();

  // Delete in safe order
  const { error: simErr } = await supabase
    .from("simulation_state")
    .delete()
    .not("id", "is", null);
  if (simErr) {
    return NextResponse.json({ error: simErr.message }, { status: 500 });
  }

  const { error: agentsErr } = await supabase
    .from("agents")
    .delete()
    .not("id", "is", null);
  if (agentsErr) {
    return NextResponse.json({ error: agentsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
