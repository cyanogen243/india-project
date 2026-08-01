ALTER TABLE volunteer_submissions
  ADD COLUMN city TEXT NOT NULL DEFAULT '';

ALTER TABLE volunteer_submissions
  ADD COLUMN team TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS volunteers_team_idx ON volunteer_submissions(team);
