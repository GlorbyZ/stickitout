-- Member profile fields, scored challenge attempts, lesson posters.

ALTER TABLE people ADD COLUMN kit TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN level TEXT NOT NULL DEFAULT '';

ALTER TABLE lessons ADD COLUMN poster_key TEXT;

CREATE TABLE IF NOT EXISTS challenge_attempts (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  score INTEGER,
  scored_at TEXT,
  scored_by TEXT,
  PRIMARY KEY (challenge_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_score ON challenge_attempts(challenge_id, score, submitted_at);
CREATE INDEX IF NOT EXISTS idx_attempts_person ON challenge_attempts(person_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_attempts_pending ON challenge_attempts(score, submitted_at);
