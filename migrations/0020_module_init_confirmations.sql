-- One-time confirmation tokens for destructive JAVA-only module
-- initialization. reinitializeSystem wipes every class/account/score on the
-- vendor training platform, so the super admin must first obtain a short-lived
-- single-use token via POST /api/sso/module/init/confirm and supply it to
-- POST /api/sso/module/init. The row is consumed atomically on first use
-- (DELETE in the same statement that validates the hash), so it cannot be
-- replayed; issuing a new token overwrites the previous one.
CREATE TABLE IF NOT EXISTS module_init_confirmations (
    competition_id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
