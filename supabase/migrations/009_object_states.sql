-- ============================================================
-- Generative Village — World object state (hybrid: named state + free text)
--
-- This is the Smallville-style perception substrate. Each row tracks the
-- current condition of an interactable in the world. Verbs mutate these
-- rows; agents within proximity read them as part of their observation.
--
-- Hybrid state choice ("option C"):
--   - `state`        : short named state ("cold", "baking", "ready") — drives
--                      sprite selection + deterministic transitions.
--   - `state_detail` : optional free-text detail ("rye loaves and a sweet
--                      roll, still warm") — surfaces in other agents' prompts
--                      so perception is rich and varied without losing the
--                      structural anchor of a named state.
--
-- last_updated_tick lets the tick handler decay stale states (e.g. an oven
-- left "ready" for too long goes back to "cold" with detail cleared).
-- last_actor_id remembers who put it in this state — used for memory
-- generation ("Hale just baked").
-- ============================================================

CREATE TABLE IF NOT EXISTS object_states (
  object_id          TEXT PRIMARY KEY,
  state              TEXT NOT NULL,
  state_detail       TEXT,
  last_updated_tick  INT NOT NULL DEFAULT 0,
  last_actor_id      UUID REFERENCES agents(id) ON DELETE SET NULL
);
