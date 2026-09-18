ALTER TABLE quotes ADD COLUMN settled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE source_status (
  source TEXT PRIMARY KEY,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT
);
