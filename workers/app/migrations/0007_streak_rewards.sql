-- Streak milestone rewards. Earned once, kept if the streak later breaks.

CREATE TABLE IF NOT EXISTS streak_rewards (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  days INTEGER NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (person_id, days)
);

CREATE INDEX IF NOT EXISTS idx_streak_rewards_person ON streak_rewards(person_id, days);
