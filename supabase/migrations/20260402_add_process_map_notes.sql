create table if not exists process_map_notes (
  step_code text primary key,
  note text not null default '',
  updated_at timestamptz not null default now()
);
