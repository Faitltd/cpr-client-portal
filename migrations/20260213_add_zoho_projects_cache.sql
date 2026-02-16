-- Optional: cache project-to-client mappings to reduce API calls
-- The existing unused 'projects' table can serve this purpose.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS zoho_project_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_data JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_zoho_project_id ON projects(zoho_project_id);

