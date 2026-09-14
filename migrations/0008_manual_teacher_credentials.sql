CREATE TABLE IF NOT EXISTS user_manual_teacher_credentials (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    login_url TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, competition_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_teacher_credentials_competition
    ON user_manual_teacher_credentials(competition_id);
