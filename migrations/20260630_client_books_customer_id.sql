-- Explicit Zoho Books customer id per client. Used when a client's portal
-- login email doesn't match their Books customer email (so the email-based
-- lookup finds nothing). When set, the invoices endpoint uses it directly.
alter table clients add column if not exists books_customer_id text;
