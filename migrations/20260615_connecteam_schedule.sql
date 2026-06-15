-- Connecteam schedule ingestion.
-- We subscribe to the Connecteam iCal feed(s) and mirror shifts into the portal
-- (and, later, Zoho Shifts). One owner/admin feed carries the whole schedule
-- with the assigned crew embedded in each event's DESCRIPTION.

CREATE TABLE IF NOT EXISTS connecteam_feeds (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    label text,
    ics_url text NOT NULL UNIQUE,
    active boolean DEFAULT true,
    last_synced_at timestamptz,
    last_sync_error text,
    last_shift_count integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connecteam_shifts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_id uuid REFERENCES connecteam_feeds(id) ON DELETE CASCADE,
    uid text NOT NULL UNIQUE,
    title text,
    location text,
    starts_at timestamptz,
    ends_at timestamptz,
    crew text[] DEFAULT '{}',
    notes text,
    zoho_shift_id text,
    seen_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connecteam_shifts_starts ON connecteam_shifts(starts_at);
CREATE INDEX IF NOT EXISTS idx_connecteam_shifts_feed ON connecteam_shifts(feed_id);

ALTER TABLE connecteam_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE connecteam_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage connecteam_feeds"
    ON connecteam_feeds FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage connecteam_shifts"
    ON connecteam_shifts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_connecteam_feeds_updated_at
    BEFORE UPDATE ON connecteam_feeds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
