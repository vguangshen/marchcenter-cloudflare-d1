CREATE TABLE IF NOT EXISTS login_verification_codes (
    user_id INTEGER NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'login',
    code_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER,
    PRIMARY KEY (user_id, purpose),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_login_verification_codes_expires_at
    ON login_verification_codes (expires_at);
