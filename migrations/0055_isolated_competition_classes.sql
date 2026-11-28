ALTER TABLE competition_events ADD COLUMN class_name TEXT CHECK (length(trim(class_name)) BETWEEN 1 AND 60);
ALTER TABLE competition_events ADD COLUMN request_id TEXT;
ALTER TABLE competition_events ADD COLUMN request_fingerprint TEXT;
ALTER TABLE competition_events ADD COLUMN duration_hours INTEGER CHECK (duration_hours BETWEEN 1 AND 168);
ALTER TABLE competition_events ADD COLUMN opened_at INTEGER;
ALTER TABLE competition_events ADD COLUMN preparation_failed_at INTEGER;

CREATE UNIQUE INDEX idx_competition_events_request ON competition_events (created_by, request_id);
