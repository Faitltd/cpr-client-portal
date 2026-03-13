-- Add phase_order column to scope_tasks for preserving estimate section ordering
ALTER TABLE scope_tasks ADD COLUMN IF NOT EXISTS phase_order INTEGER DEFAULT 0;
