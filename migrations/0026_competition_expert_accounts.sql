CREATE TABLE IF NOT EXISTS user_competition_expert_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, competition_id)
);

CREATE INDEX IF NOT EXISTS idx_expert_account_competition
    ON user_competition_expert_accounts(competition_id);

