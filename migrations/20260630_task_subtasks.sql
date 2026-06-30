-- Per-task QC subtasks (checklist items), keyed to the Zoho Projects parent
-- task id. Generated from the trade-checklist library based on each task's
-- trade. Checkable by trade partners; hidden from clients.
create table if not exists task_subtasks (
  id uuid primary key default gen_random_uuid(),
  deal_id text,
  project_id text,
  parent_task_id text not null,
  trade_slug text,
  label text not null,
  sort_order int not null default 0,
  is_done boolean not null default false,
  done_by text,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (parent_task_id, label)
);
create index if not exists idx_task_subtasks_parent on task_subtasks (parent_task_id);
create index if not exists idx_task_subtasks_project on task_subtasks (project_id);
