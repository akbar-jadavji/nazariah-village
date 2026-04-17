-- ============================================================
-- Generative Village — Chunk 5 Migration
-- Adds the conversations table for logging agent dialogues.
-- Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_a_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_b_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sim_tick    INTEGER NOT NULL,
  turns       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- turns format: [{ speaker: string, speakerId: string, line: string, thought: string }]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_tick
  ON conversations (sim_tick DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_agent_a
  ON conversations (agent_a_id, sim_tick DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_agent_b
  ON conversations (agent_b_id, sim_tick DESC);
