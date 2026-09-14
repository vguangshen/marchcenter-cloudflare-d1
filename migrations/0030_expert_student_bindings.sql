CREATE TABLE IF NOT EXISTS user_competition_expert_student_bindings (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    student_index INTEGER NOT NULL,
    student_account_name TEXT NOT NULL,
    expert_account_name TEXT NOT NULL,
    bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, competition_id, student_index)
);

CREATE INDEX IF NOT EXISTS idx_expert_student_bindings_competition
    ON user_competition_expert_student_bindings(competition_id);
