ALTER TABLE trade_partners
ADD COLUMN IF NOT EXISTS zoho_trade_partner_id TEXT;

ALTER TABLE trade_partners
ADD CONSTRAINT trade_partners_zoho_trade_partner_id_key UNIQUE (zoho_trade_partner_id);
