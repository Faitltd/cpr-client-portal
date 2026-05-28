-- Phase 3A: sync-run log for the auto-sync cron job.
-- One row per cron tick. Per-Deal results stored in deals JSONB.

CREATE TABLE IF NOT EXISTS bot_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'admin')),
    sources TEXT[] NOT NULL,
    deal_count INT NOT NULL DEFAULT 0,
    ok_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    duration_ms INT,
    summary JSONB DEFAULT '{}'::jsonb,
    deals JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bot_sync_runs_started ON bot_sync_runs (started_at DESC);
