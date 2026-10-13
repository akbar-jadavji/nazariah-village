-- ============================================================
-- Generative Village — body-state drift as a single bulk UPDATE
--
-- The tick handler was firing 25 separate UPDATEs per tick (one per agent)
-- to bump hunger up and energy down. Supabase's pool occasionally choked
-- on the concurrency burst, surfacing as `TypeError: fetch failed`. This
-- function does the same work as one server-side statement.
--
-- Caller: `await supabase.rpc('agent_state_drift', { hunger_inc: 1, energy_dec: 1 })`
-- ============================================================

CREATE OR REPLACE FUNCTION agent_state_drift(hunger_inc INT, energy_dec INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE agents
  SET hunger = LEAST(100, COALESCE(hunger, 40) + hunger_inc),
      energy = GREATEST(0,   COALESCE(energy, 70) - energy_dec);
$$;
