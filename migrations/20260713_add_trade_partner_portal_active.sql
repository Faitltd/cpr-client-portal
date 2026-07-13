-- Add a deactivation flag to trade_partners so the portal can cut off access
-- for a deactivated trade partner (mirrors clients.portal_active).
ALTER TABLE public.trade_partners
  ADD COLUMN IF NOT EXISTS portal_active boolean NOT NULL DEFAULT true;
