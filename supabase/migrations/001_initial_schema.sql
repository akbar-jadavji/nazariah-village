-- ============================================================
-- Generative Village — Initial Schema
-- Run this in Supabase SQL Editor (or via `supabase db push`)
-- ============================================================

-- Enable pgvector extension for embedding similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- ------------------------------------------------------------
-- agents
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  backstory TEXT NOT NULL,
  traits TEXT[] NOT NULL,
  sprite_key TEXT NOT NULL,
  home_building_id TEXT NOT NULL,
  current_x INTEGER NOT NULL,
  current_y INTEGER NOT NULL,
  current_building TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  is_sleeping BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- memories (append-only, immutable once created)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sim_tick INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('observation','conversation','reflection','internal_thought')),
  content TEXT NOT NULL,
  embedding vector(1536),
  importance REAL NOT NULL DEFAULT 0.0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_agent_tick
  ON memories (agent_id, sim_tick DESC);

-- pgvector index for similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ------------------------------------------------------------
-- goals
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','abandoned')),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at_tick INTEGER NOT NULL,
  completed_at_tick INTEGER
);

CREATE INDEX IF NOT EXISTS idx_goals_agent_status
  ON goals (agent_id, status);

-- ------------------------------------------------------------
-- relationships (composite PK)
-- target_id may reference an agent or the player, so it is NOT a FK
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relationships (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_id UUID NOT NULL,
  familiarity REAL NOT NULL DEFAULT 0.0,
  sentiment REAL NOT NULL DEFAULT 0.0,
  summary TEXT,
  last_interaction_tick INTEGER,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, target_id)
);

-- ------------------------------------------------------------
-- simulation_state (singleton — one row represents the current world)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS simulation_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  current_tick INTEGER NOT NULL DEFAULT 0,
  current_day INTEGER NOT NULL DEFAULT 1,
  time_of_day TEXT NOT NULL DEFAULT 'morning'
    CHECK (time_of_day IN ('morning','midday','afternoon','evening','night')),
  is_paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- saved_states (full serialized snapshots)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
