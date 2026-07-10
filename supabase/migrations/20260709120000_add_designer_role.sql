-- Staff roles for the internal portal. One designers table, three dashboards:
--   designer — Mary Sue, Monika, June: Field Update, CRM, Tasks, Schedule
--   ops      — Jeff: Field Dashboard, Field Update, CRM, Tasks, Financials, Schedule
--   finance  — Sean: Finance (Books AR), Financials, CRM
-- Admin stays env-based (PORTAL_ADMIN_EMAILS).

ALTER TABLE designers
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'designer';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'designers_role_check'
    ) THEN
        ALTER TABLE designers
            ADD CONSTRAINT designers_role_check
            CHECK (role IN ('designer', 'ops', 'finance'));
    END IF;
END $$;

UPDATE designers SET role = 'ops' WHERE email = 'jeff@homecpr.pro';
UPDATE designers SET role = 'finance' WHERE email = 'sean@homecpr.pro';
