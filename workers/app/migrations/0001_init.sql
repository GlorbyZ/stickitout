CREATE TABLE people (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE memberships (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  plan TEXT,
  status TEXT NOT NULL DEFAULT 'waitlist',
  stripe_customer_id TEXT,
  stripe_sub_id TEXT
);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  week_index INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  video_url TEXT
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  published_at TEXT
);

CREATE TABLE practice_logs (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
  bpm REAL,
  notes TEXT,
  at TEXT NOT NULL
);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX idx_sessions_hash ON sessions(token_hash);
CREATE INDEX idx_magic_hash ON magic_links(token_hash);
CREATE INDEX idx_people_email ON people(email);
CREATE INDEX idx_lessons_published ON lessons(published_at);
CREATE INDEX idx_challenges_published ON challenges(published_at);
