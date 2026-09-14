-- Per-user per-card remote class removal state. The remote class can be
-- deleted (DelGroup) on the vendor platform while the MarchCenter card
-- remains as a "ghost" entry the user can restore at any time.
CREATE TABLE IF NOT EXISTS user_class_removals (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, competition_id)
);
