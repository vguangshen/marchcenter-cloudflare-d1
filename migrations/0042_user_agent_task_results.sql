CREATE TABLE user_agent_task_results (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    sso_config_id INTEGER NOT NULL,
    target_url TEXT NOT NULL,
    task_id TEXT,
    answer_type TEXT,
    software_unique TEXT,
    status TEXT NOT NULL CHECK (status IN ('in_progress', 'scoring', 'completed')),
    score REAL CHECK (score IS NULL OR (status = 'completed' AND score BETWEEN 0 AND 100)),
    PRIMARY KEY (user_id, competition_id)
);

CREATE INDEX idx_user_agent_task_results_competition ON user_agent_task_results (competition_id);
