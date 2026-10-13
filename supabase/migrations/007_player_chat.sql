-- ============================================================
-- Generative Village — Player↔Agent chat parity migration.
--
-- Player chats need to live in the same shapes as agent↔agent chats so the
-- inspector and the relationship system Just Work. Two changes:
--
--   1. conversations.agent_b_id: was NOT NULL with FK to agents(id). The
--      player isn't an agent, so we drop the FK and allow NULL. A NULL
--      agent_b_id means "this was a chat with the player"; player_name
--      carries the human-friendly label.
--
--   2. relationships.target_id remains UUID. Player relationships use the
--      reserved nil-UUID '00000000-0000-0000-0000-000000000000'. This way
--      target_id stays a clean UUID column with no string mixing, while a
--      single application-level constant identifies "the player". A new
--      target_name_override column carries the actual player name so the
--      inspector can label the row correctly.
-- ============================================================

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_agent_b_id_fkey;
ALTER TABLE conversations
  ALTER COLUMN agent_b_id DROP NOT NULL;
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS player_name TEXT;

ALTER TABLE relationships
  ADD COLUMN IF NOT EXISTS target_name_override TEXT;
