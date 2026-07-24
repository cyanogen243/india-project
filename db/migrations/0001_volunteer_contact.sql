ALTER TABLE volunteer_submissions
  ADD COLUMN contact_platform TEXT NOT NULL DEFAULT 'telegram';

ALTER TABLE volunteer_submissions
  ADD COLUMN contact_handle TEXT NOT NULL DEFAULT '';
