import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";

export const runtime = "nodejs";

const TICKS_PER_DAY = 96;
function timeOfDay(tick: number): "morning" | "midday" | "afternoon" | "evening" | "night" {
  const h = tick % TICKS_PER_DAY;
  if (h < 20) return "morning";
  if (h < 48) return "midday";
  if (h < 64) return "afternoon";
  if (h < 80) return "evening";
  return "night";
}

/**
 * GET /api/agent/[id]/conversations
 * Returns conversations the agent participated in (as A or B), most recent
 * first. Resolves the OTHER agent's name and adds a derived day/time-of-day
 * so the UI can render readable timestamps without recomputing.
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
      .select("id, agent_a_id, agent_b_id, player_name, sim_tick, turns, created_at")
      .eq("agent_a_id", id)
      .order("sim_tick", { ascending: false })
      .limit(50),
    supabase
      .from("conversations")
      .select("id, agent_a_id, agent_b_id, player_name, sim_tick, turns, created_at")
      .eq("agent_b_id", id)
      .order("sim_tick", { ascending: false })
      .limit(50),
  ]);
  if (asA.error) return NextResponse.json({ error: asA.error.message }, { status: 500 });
  if (asB.error) return NextResponse.json({ error: asB.error.message }, { status: 500 });

  // Sort + cap combined results.
  const combined = [...(asA.data ?? []), ...(asB.data ?? [])]
    .sort((a, b) => b.sim_tick - a.sim_tick)
    .slice(0, 50);

  // Resolve names of every OTHER agent that appears, in a single query.
  // Skip null partner_ids (those are player chats — partner_name is the player_name field).
  const otherIds = new Set<string>();
  for (const c of combined) {
    const otherId = c.agent_a_id === id ? c.agent_b_id : c.agent_a_id;
    if (otherId) otherIds.add(otherId);
  }
  let nameMap = new Map<string, string>();
  if (otherIds.size > 0) {
    const { data: rows } = await supabase
      .from("agents")
      .select("id, name")
      .in("id", [...otherIds]);
    nameMap = new Map((rows ?? []).map((r) => [r.id, r.name]));
  }

  // Annotate each row. For player chats (agent_b_id null), use player_name.
  const conversations = combined.map((c) => {
    const otherId = c.agent_a_id === id ? c.agent_b_id : c.agent_a_id;
    const isPlayerChat = !otherId;
    return {
      id: c.id,
      otherId: otherId ?? null,
      otherName: isPlayerChat ? (c.player_name ?? "the player") : (nameMap.get(otherId!) ?? "Unknown"),
      isPlayerChat,
      sim_tick: c.sim_tick,
      day: Math.floor(c.sim_tick / TICKS_PER_DAY) + 1,
      time_of_day: timeOfDay(c.sim_tick),
      turns: c.turns ?? [],
      created_at: c.created_at,
    };
  });

  return NextResponse.json({ conversations });
}
