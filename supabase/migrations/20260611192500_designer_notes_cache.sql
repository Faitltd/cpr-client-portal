-- Designer notes cache: durable store for Ball_In_Court / Ball_In_Court_Note
-- edits, pushed to Zoho asynchronously. Trigger trims history to the last 5
-- edits per (deal_id, field). Applied to production 2026-06-11 via Supabase.

CREATE TABLE IF NOT EXISTS public.designer_notes (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	deal_id text NOT NULL,
	field text NOT NULL CHECK (field IN ('Ball_In_Court', 'Ball_In_Court_Note')),
	value text,
	edited_by text,
	edited_at timestamptz NOT NULL DEFAULT now(),
	pushed_to_zoho_at timestamptz,
	push_error text
);

CREATE INDEX IF NOT EXISTS idx_designer_notes_deal_field
	ON public.designer_notes (deal_id, field, edited_at DESC);

ALTER TABLE public.designer_notes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.designer_notes_trim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	DELETE FROM public.designer_notes
	WHERE deal_id = NEW.deal_id
		AND field = NEW.field
		AND id NOT IN (
			SELECT id FROM public.designer_notes
			WHERE deal_id = NEW.deal_id AND field = NEW.field
			ORDER BY edited_at DESC, id DESC
			LIMIT 5
		);
	RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS designer_notes_trim_trg ON public.designer_notes;
CREATE TRIGGER designer_notes_trim_trg
	AFTER INSERT ON public.designer_notes
	FOR EACH ROW EXECUTE FUNCTION public.designer_notes_trim();

-- Daily cleanup: drop pushed rows older than 90 days. Returns rows deleted.
CREATE OR REPLACE FUNCTION public.designer_notes_purge_old() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
	DELETE FROM public.designer_notes
	WHERE pushed_to_zoho_at IS NOT NULL
		AND edited_at < now() - interval '90 days';
	GET DIAGNOSTICS n = ROW_COUNT;
	RETURN n;
END;
$$;
