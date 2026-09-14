CREATE TABLE IF NOT EXISTS registration_verification_codes (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    username TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_registration_verification_codes_expires_at
    ON registration_verification_codes (expires_at);
