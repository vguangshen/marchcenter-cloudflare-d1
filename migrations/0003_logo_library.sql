CREATE TABLE IF NOT EXISTS logo_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data_url TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_logo_library_created_at ON logo_library(created_at DESC);
