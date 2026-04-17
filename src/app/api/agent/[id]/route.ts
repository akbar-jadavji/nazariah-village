import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/agent/[id]
 * Returns full agent profile: row, recent memories, active goals, relationships.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = serverClient();

  const [agentRes, memoriesRes, goalsRes, relsRes] = await Promise.all([
    supabase.from("agents").select("*").eq("id", id).single(),
    supabase
      .from("memories")
      .select("type, content, sim_tick, importance")
      .eq("agent_id", id)
      .order("sim_tick", { ascending: false })
      .limit(10),
    supabase
      .from("goals")
      .select("id, description, priority, status, steps, created_at_tick")
      .eq("agent_id", id)
      .eq("status", "active")
      .order("priority", { ascending: false }),
    supabase
      .from("relationships")
      .select("target_id, familiarity, sentiment, summary, interaction_count")
      .eq("agent_id", id)
      .order("familiarity", { ascending: false })
      .limit(6),
  ]);

  if (agentRes.error)
    return NextResponse.json({ error: agentRes.error.message }, { status: 404 });

  // Resolve relationship target names
  const targetIds = (relsRes.data ?? []).map((r) => r.target_id);
  let targetNames: Record<string, string> = {};
  if (targetIds.length > 0) {
    const { data: targets } = await supabase
      .from("agents")
      .select("id, name")
      .in("id", targetIds);
    targetNames = Object.fromEntries((targets ?? []).map((t) => [t.id, t.name]));
  }

  return NextResponse.json({
    agent: agentRes.data,
    memories: memoriesRes.data ?? [],
    goals: goalsRes.data ?? [],
    relationships: (relsRes.data ?? []).map((r) => ({
      ...r,
      targetName: targetNames[r.target_id] ?? "Unknown",
    })),
  });
}
