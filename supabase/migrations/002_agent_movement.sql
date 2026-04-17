-- ============================================================
-- Generative Village — Chunk 3 Migration
-- Adds movement/path columns to agents table.
-- Safe to re-run.
-- ============================================================

-- path: remaining tiles the agent will walk to, e.g. [{"x":12,"y":14}, ...]
--       null when the agent has no active path.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS path JSONB;

-- next_decision_tick: the earliest sim tick at which this agent should take a
-- new action. Used to hold agents "inside" a building for a while, or to pause
-- them briefly between wanders.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS next_decision_tick INTEGER NOT NULL DEFAULT 0;
