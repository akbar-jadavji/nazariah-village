-- ============================================================
-- Generative Village — MVP action system + agent body state.
--
-- Adds the small amount of persistent state that turns "agents stand and
-- emit text" into "agents physically do things at world objects":
--
--   - hunger / energy: body state numbers that drive emergent behaviour
--     (the observation prompt surfaces them, so the LLM picks `eat` when
--     hungry, `sleep` when tired, without being told to).
--
--   - current_activity_verb / current_activity_target: when an agent decides
--     to e.g. `pray` at `altar_chapel`, we carry that intent on the row both
--     while they walk to it (status='walking') and while they're doing it
--     (status='doing_activity'). On arrival the move endpoint switches to
--     the doing state; when the activity duration elapses the tick endpoint
--     fires the completion handler (memory + goal-completion + state effect).
-- ============================================================

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS hunger INT NOT NULL DEFAULT 40;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS energy INT NOT NULL DEFAULT 70;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS current_activity_verb TEXT;
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS current_activity_target TEXT;
