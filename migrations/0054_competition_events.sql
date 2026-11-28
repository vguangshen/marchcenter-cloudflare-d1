CREATE TABLE competition_events (
    id TEXT PRIMARY KEY,
    competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    card_binding TEXT NOT NULL CHECK (length(card_binding) = 64),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
    closed_at INTEGER,
    closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_competition_events_owner ON competition_events (created_by, created_at DESC);
CREATE INDEX idx_competition_events_card ON competition_events (competition_id);

CREATE TABLE competition_event_teachers (
    event_id TEXT NOT NULL REFERENCES competition_events(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at INTEGER,
    entered_at INTEGER,
    PRIMARY KEY (event_id, teacher_id)
);

CREATE INDEX idx_competition_event_teachers_account ON competition_event_teachers (teacher_id, event_id);
