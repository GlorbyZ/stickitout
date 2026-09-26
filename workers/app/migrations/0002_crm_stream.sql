-- CRM + Stream columns. Waitlist stays waitlist until an admin marks founding/active.

ALTER TABLE people ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE people ADD COLUMN last_seen_at TEXT;

ALTER TABLE lessons ADD COLUMN stream_uid TEXT;
ALTER TABLE lessons ADD COLUMN summary TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS crm_notes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  body TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crm_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS crm_person_tags (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES crm_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, tag_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  watched_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (person_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_notes_person ON crm_notes(person_id, at);
CREATE INDEX IF NOT EXISTS idx_progress_person ON lesson_progress(person_id);
CREATE INDEX IF NOT EXISTS idx_lessons_stream ON lessons(stream_uid);

INSERT OR IGNORE INTO crm_tags (id, name) VALUES
  ('tag-waitlist', 'waitlist'),
  ('tag-founding', 'founding'),
  ('tag-student', 'student');
