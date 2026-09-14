-- Short-lived, single-use launch tickets for the HTTP Root login relay.
-- Only a SHA-256 hash is stored; credentials remain encrypted on competitions.
CREATE TABLE IF NOT EXISTS admin_entry_launch_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_entry_launch_tokens_expiry
    ON admin_entry_launch_tokens (expires_at);
