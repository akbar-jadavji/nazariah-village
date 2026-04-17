import { createClient } from "@supabase/supabase-js";

// Server-side client. Uses the service role key so routes can bypass RLS.
// This must only be imported from server code (route handlers, server components).
export function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// DB row types — kept in sync with supabase/migrations/*
export type AgentRow = {
  id: string;
  name: string;
  backstory: string;
  traits: string[];
  sprite_key: string;
  home_building_id: string;
  current_x: number;
  current_y: number;
  current_building: string | null;
  status: string;
  is_sleeping: boolean;
  path: { x: number; y: number }[] | null;
  next_decision_tick: number;
  created_at: string;
};

export type MemoryRow = {
  id: string;
  agent_id: string;
  sim_tick: number;
  type: "observation" | "conversation" | "reflection" | "internal_thought";
  content: string;
  embedding: number[] | null;
  importance: number;
  last_accessed: string;
  access_count: number;
  created_at: string;
};

export type GoalRow = {
  id: string;
  agent_id: string;
  description: string;
  priority: number;
  status: "active" | "completed" | "abandoned";
  steps: unknown;
  created_at_tick: number;
  completed_at_tick: number | null;
};

export type RelationshipRow = {
  agent_id: string;
  target_id: string;
  familiarity: number;
  sentiment: number;
  summary: string | null;
  last_interaction_tick: number | null;
  interaction_count: number;
};

export type SimulationStateRow = {
  id: string;
  current_tick: number;
  current_day: number;
  time_of_day: "morning" | "midday" | "afternoon" | "evening" | "night";
  is_paused: boolean;
  created_at: string;
};
