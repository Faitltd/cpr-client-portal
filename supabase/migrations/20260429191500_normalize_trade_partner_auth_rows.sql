-- Normalize legacy trade partner auth rows so indexed exact email lookups can
-- succeed without falling back to a full-table email scan.

UPDATE trade_partners
SET
	password_hash = NULLIF(BTRIM(password_hash), ''),
	updated_at = NOW()
WHERE password_hash IS DISTINCT FROM NULLIF(BTRIM(password_hash), '');

WITH normalized_trade_partners AS (
	SELECT
		id,
		LOWER(BTRIM(email)) AS normalized_email,
		COUNT(*) OVER (PARTITION BY LOWER(BTRIM(email))) AS normalized_email_count
	FROM trade_partners
)
UPDATE trade_partners AS trade_partner
SET
	email = normalized_trade_partners.normalized_email,
	updated_at = NOW()
FROM normalized_trade_partners
WHERE trade_partner.id = normalized_trade_partners.id
	AND normalized_trade_partners.normalized_email_count = 1
	AND trade_partner.email IS DISTINCT FROM normalized_trade_partners.normalized_email;
