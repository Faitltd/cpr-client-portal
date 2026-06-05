-- Cache table for per-file Zoho WorkDrive external share URLs.
-- We mint these on demand for trade partners (who have no Zoho account)
-- and reuse the URL on every subsequent listing so we don't pile up
-- duplicate share links in WorkDrive.

CREATE TABLE IF NOT EXISTS workdrive_file_shares (
    file_id TEXT PRIMARY KEY,
    external_url TEXT NOT NULL,
    link_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workdrive_file_shares_last_used_idx
    ON workdrive_file_shares (last_used_at DESC);
