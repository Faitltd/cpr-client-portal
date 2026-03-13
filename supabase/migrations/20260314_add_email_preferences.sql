-- Email preferences per deal/client for scheduled update emails
create table if not exists email_preferences (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  client_email text not null,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'none')),
  last_sent_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, client_email)
);

-- Log of all sent emails for auditing
create table if not exists sent_emails (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  client_email text not null,
  subject text,
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_preferences_deal on email_preferences (deal_id);
create index if not exists idx_email_preferences_email on email_preferences (client_email);
create index if not exists idx_sent_emails_deal on sent_emails (deal_id);
create index if not exists idx_sent_emails_created on sent_emails (created_at);
