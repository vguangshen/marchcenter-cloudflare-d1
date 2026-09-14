ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN temporary_password_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_users_class_roster
    ON users(class_id, role, is_disabled, username);

CREATE TABLE IF NOT EXISTS system_initialization (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    initialized_by_user_id INTEGER NOT NULL,
    initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
