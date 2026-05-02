-- Add action display columns to agents table.
-- Run this in Supabase SQL Editor before restarting the simulation.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS action_description TEXT DEFAULT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS action_emoji TEXT DEFAULT NULL;
