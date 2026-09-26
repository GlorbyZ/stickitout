-- Rudiments and limb patterns: catalog, per-member progress and medals,
-- daily pick, and practice streaks.

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  discipline TEXT NOT NULL DEFAULT 'hands',
  family TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'beginner',
  sticking TEXT NOT NULL DEFAULT '',
  vex_notes TEXT,
  vex_feet TEXT,
  bpm_start INTEGER NOT NULL DEFAULT 60,
  bpm_goal INTEGER NOT NULL DEFAULT 120,
  tier TEXT NOT NULL DEFAULT 'free',
  sort_index INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pattern_progress (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  best_bpm REAL,
  medal TEXT NOT NULL DEFAULT 'dirt',
  legend_sessions INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  PRIMARY KEY (person_id, pattern_id)
);

CREATE TABLE IF NOT EXISTS pattern_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  bpm REAL,
  seconds INTEGER NOT NULL DEFAULT 0,
  clean INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_pattern_picks (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  completed_at TEXT,
  PRIMARY KEY (person_id, day)
);

CREATE TABLE IF NOT EXISTS daily_pattern_override (
  day TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  set_by TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_streaks (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  current_days INTEGER NOT NULL DEFAULT 0,
  longest_days INTEGER NOT NULL DEFAULT 0,
  total_days INTEGER NOT NULL DEFAULT 0,
  last_day TEXT
);

CREATE INDEX IF NOT EXISTS idx_patterns_group ON patterns(discipline, level, sort_index);
CREATE INDEX IF NOT EXISTS idx_patterns_tier ON patterns(tier);
CREATE INDEX IF NOT EXISTS idx_pattern_sessions_person ON pattern_sessions(person_id, at);
CREATE INDEX IF NOT EXISTS idx_pattern_progress_person ON pattern_progress(person_id);
