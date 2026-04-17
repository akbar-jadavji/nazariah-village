import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/agent/[id]/conversations
 * Returns the last 20 conversations an agent participated in (as A or B),
 * ordered by most recent first.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = serverClient();

  const [asA, asB] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, agent_a_id, agent_b_id, sim_tick, turns, created_at")
      .eq("agent_a_id", id)
      .order("sim_tick", { ascending: false })
      .limit(20),
    supabase
      .from("conversations")
      .select("id, agent_a_id, agent_b_id, sim_tick, turns, created_at")
      .eq("agent_b_id", id)
      .order("sim_tick", { ascending: false })
      .limit(20),
  ]);

  if (asA.error) return NextResponse.json({ error: asA.error.message }, { status: 500 });
  if (asB.error) return NextResponse.json({ error: asB.error.message }, { status: 500 });

  const combined = [...(asA.data ?? []), ...(asB.data ?? [])]
    .sort((a, b) => b.sim_tick - a.sim_tick)
    .slice(0, 20);

  return NextResponse.json({ conversations: combined });
}
