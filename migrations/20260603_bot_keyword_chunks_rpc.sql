-- Keyword-fallback retrieval RPC. Used by `retrieveRelevant` to find chunks
-- containing the user's distinctive query nouns (e.g. "showerhead", "kerdi")
-- even when vector similarity ranks lookalikes higher.
--
-- The supabase JS client's `.or()` filter combined with a foreign-table
-- `!inner` join was unreliable here; an RPC sidesteps that and keeps the
-- query plan in Postgres where the indexes live.
--
-- Ranks chunks by total occurrence count of the keywords (not binary match),
-- so a dense spreadsheet row that mentions "shower" 7 times (Shower Faucet,
-- Shower Valve, Shower Arm, Rainshower, Showerhead, etc.) beats an email
-- that mentions it once. Otherwise a noisy keyword like "shower" pulls
-- arbitrary email chunks ahead of the actual answer.

CREATE OR REPLACE FUNCTION bot_keyword_chunks(
  p_deal_id TEXT,
  p_keywords TEXT[],
  p_limit INT DEFAULT 24
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  source TEXT,
  subject TEXT,
  author TEXT,
  occurred_at TIMESTAMPTZ,
  source_url TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_keywords IS NULL OR array_length(p_keywords, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      bc.id AS chunk_id,
      bc.document_id,
      bc.content,
      bd.source,
      bd.subject,
      bd.author,
      bd.occurred_at,
      bd.source_url,
      (
        SELECT COALESCE(SUM(
          (LENGTH(LOWER(bc.content)) - LENGTH(REPLACE(LOWER(bc.content), LOWER(k.kw), '')))
          / NULLIF(LENGTH(k.kw), 0)
        ), 0)
        FROM unnest(p_keywords) AS k(kw)
      )::INT AS occurrences
    FROM bot_chunks bc
    JOIN bot_documents bd ON bd.id = bc.document_id
    WHERE bd.deal_id = p_deal_id
  )
  SELECT
    s.chunk_id,
    s.document_id,
    s.content,
    s.source,
    s.subject,
    s.author,
    s.occurred_at,
    s.source_url,
    LEAST(s.occurrences::FLOAT / 5.0, 1.0) AS similarity
  FROM scored s
  WHERE s.occurrences > 0
  ORDER BY s.occurrences DESC, s.occurred_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION bot_keyword_chunks(TEXT, TEXT[], INT) TO anon, authenticated, service_role;
