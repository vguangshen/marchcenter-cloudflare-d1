-- Resource-level revisions let clients poll cheaply and only download a
-- content collection when it actually changed.
ALTER TABLE announcements ADD COLUMN close_at TEXT;

CREATE TABLE IF NOT EXISTS content_revisions (
    content_type TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO content_revisions (content_type, revision)
VALUES ('announcements', 0), ('gifts', 0);
