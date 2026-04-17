-- ============================================================
-- Generative Village — Chunk 4 Migration
-- pgvector retrieval RPC function for memory similarity search.
-- Safe to re-run (OR REPLACE).
-- ============================================================

-- match_memories: retrieve the N nearest memories for an agent by cosine
-- similarity, then let the caller re-rank by recency × relevance × importance.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  p_agent_id      UUID,
  match_count     INT DEFAULT 30
)
RETURNS TABLE (
  id            UUID,
  sim_tick      INT,
  type          TEXT,
  content       TEXT,
  importance    REAL,
  relevance     FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    sim_tick,
    type,
    content,
    importance,
    1 - (embedding <=> query_embedding) AS relevance
  FROM memories
  WHERE agent_id = p_agent_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
