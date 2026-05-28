-- Phase 4: multi-user Zoho OAuth.
-- Each CPR team member grants their own token. Bot uses the owner's token to
-- fetch their own email content (Zoho API doesn't let one user read another's
-- email bodies even with org admin).

ALTER TABLE zoho_tokens ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE zoho_tokens ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

-- The existing single row should be the primary (used for non-user-specific
-- operations: CRM, Cliq, Books). Mark it so.
UPDATE zoho_tokens
SET is_primary = TRUE
WHERE is_primary IS NOT TRUE
  AND id = (SELECT id FROM zoho_tokens ORDER BY updated_at DESC LIMIT 1);

-- One token per Zoho user_id. Enables ON CONFLICT (user_id) DO UPDATE on
-- subsequent OAuth callbacks.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'zoho_tokens_user_id_unique'
    ) THEN
        ALTER TABLE zoho_tokens
            ADD CONSTRAINT zoho_tokens_user_id_unique UNIQUE (user_id);
    END IF;
END$$;

-- Only one primary at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zoho_tokens_one_primary
    ON zoho_tokens ((1)) WHERE is_primary = TRUE;
