-- Curated, client-facing photos for field updates.
-- These are the only photos shown in the homeowner portal and are mirrored to
-- the deal's WorkDrive "Client Portal/Photos" folder. Existing rows keep NULL.
ALTER TABLE field_updates ADD COLUMN IF NOT EXISTS client_photo_ids text[];
