import { NextRequest, NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase";
import { openai, MODEL_LOW } from "@/lib/openai";

export const runtime = "nodejs";

type HistoryMessage = { role: "user" | "assistant"; content: string };

async function storePlayerInteraction(
  agentId: string,
  playerName: string,
  playerMessage: string,
  agentResponse: string,
  supabase: ReturnType<typeof serverClient>,
) {
  const stateRes = await supabase
    .from("simulation_state")
    .select("current_tick")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tick = stateRes.data?.current_tick ?? 0;
  const now = new Date().toISOString();

  const content = `I spoke with ${playerName} (the village visitor). They said: "${playerMessage.slice(0, 150)}". I told them: "${agentResponse.slice(0, 150)}"`;

  const relRes = await supabase
    .from("relationships")
    .select("familiarity, sentiment, interaction_count, summary")
    .eq("agent_id", agentId)
    .eq("target_id", "player")
    .maybeSingle();
  const existing = relRes.data;
  const newCount = (existing?.interaction_count ?? 0) + 1;

  await Promise.all([
    supabase.from("memories").insert({
      agent_id: agentId,
      sim_tick: tick,
      type: "conversation",
      content,
      embedding: null,
      importance: 0.7,
      last_accessed: now,
      access_count: 0,
    }),
    supabase.from("relationships").upsert(
      {
        agent_id: agentId,
        target_id: "player",
        familiarity: Math.min(1, (existing?.familiarity ?? 0) + 0.05),
        sentiment: existing?.sentiment ?? 0,
        summary:
          newCount % 5 === 0
            ? `${playerName} is a visitor to the village. We have spoken ${newCount} times.`
            : existing?.summary ??
              `${playerName} is a newcomer who visited the village.`,
        last_interaction_tick: tick,
        interaction_count: newCount,
      },
      { onConflict: "agent_id,target_id" },
    ),
  ]);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    message?: string;
    playerName?: string;
    history?: HistoryMessage[];
  };
  const { message, playerName = "Visitor", history = [] } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  const supabase = serverClient();

  const [agentRes, memoriesRes, relRes, stateRes] = await Promise.all([
    supabase.from("agents").select("name, backstory, traits").eq("id", id).single(),
    supabase
      .from("memories")
      .select("content, sim_tick")
      .eq("agent_id", id)
      .in("type", ["conversation", "reflection"])
      .order("sim_tick", { ascending: false })
      .limit(8),
    supabase
      .from("relationships")
      .select("familiarity, sentiment, summary, interaction_count")
      .eq("agent_id", id)
      .eq("target_id", "player")
      .maybeSingle(),
    supabase
      .from("simulation_state")
      .select("time_of_day, current_day")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (agentRes.error || !agentRes.data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = agentRes.data;
  const rel = relRes.data;
  const timeOfDay = stateRes.data?.time_of_day ?? "morning";
  const day = stateRes.data?.current_day ?? 1;

  const famDesc =
    !rel || rel.interaction_count === 0
      ? `${playerName} is a stranger you have just met.`
      : rel.familiarity < 0.3
        ? `You have briefly met ${playerName} before.`
        : rel.familiarity < 0.6
          ? `You know ${playerName} a little.`
          : `You know ${playerName} fairly well.`;

  const sentDesc =
    !rel ? ""
    : rel.sentiment < -0.3 ? " You have some reservations about them."
    : rel.sentiment > 0.3 ? " You feel warmly toward them."
    : "";

  const relSummary = rel?.summary
    ? `\nHistory with ${playerName}: ${rel.summary}`
    : "";

  const playerMemories = (memoriesRes.data ?? [])
    .filter((m) => m.content.toLowerCase().includes(playerName.toLowerCase()))
    .slice(0, 4)
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join("\n");

  const memContext = playerMemories
    ? `\nYour memories involving ${playerName}:\n${playerMemories}`
    : "";

  const system = `You are ${agent.name}, a character in a fantasy village simulation.
Backstory: ${agent.backstory}
Personality traits: ${agent.traits.join(", ")}.
It is ${timeOfDay} on Day ${day}.
You are speaking directly with ${playerName}, a newcomer to the village. ${famDesc}${sentDesc}${relSummary}${memContext}
Stay in character at all times. Speak naturally and concisely (2–4 sentences). Reference your memories and surroundings, not unvisited places or incorrect times of day. Do not reveal that you are an AI.
Respond only with your spoken dialogue — no narration or stage directions.`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: system },
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let streamResponse;
  try {
    streamResponse = await openai().chat.completions.create({
      model: MODEL_LOW,
      messages,
      stream: true as const,
      max_tokens: 200,
      temperature: 0.85,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const chunk of streamResponse) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) {
            fullText += text;
            controller.enqueue(encoder.encode(text));
          }
        }
      } finally {
        controller.close();
        if (fullText) {
          storePlayerInteraction(id, playerName, message, fullText, supabase).catch(
            (e) => console.error("player interaction store failed:", e),
          );
        }
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
