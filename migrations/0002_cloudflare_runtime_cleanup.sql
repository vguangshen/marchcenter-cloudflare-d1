-- Remove the retired database-configured SOAP workflow system.
-- The .NET and sandbox adapters continue to use their built-in SOAP protocol client.
UPDATE sso_configs
SET config_data = json_remove(config_data, '$.soapWorkflowId')
WHERE json_valid(config_data) AND json_type(config_data, '$.soapWorkflowId') IS NOT NULL;

CREATE TABLE competitions_clean (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT,
    url TEXT NOT NULL,
    category TEXT,
    status_text TEXT,
    description TEXT,
    color TEXT,
    custom_icon TEXT,
    logo_background TEXT NOT NULL DEFAULT 'transparent',
    unlock_time TEXT,
    lock_time TEXT,
    custom_prompt TEXT,
    sso_config_id INTEGER,
    sso_method TEXT,
    class_type INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO competitions_clean (
    id, title, subtitle, url, category, status_text, description, color, custom_icon,
    logo_background, unlock_time, lock_time, custom_prompt, sso_config_id, sso_method,
    class_type, created_at
)
SELECT id, title, subtitle, url, category, status_text, description, color, custom_icon,
       logo_background, unlock_time, lock_time, custom_prompt, sso_config_id, sso_method,
       class_type, created_at
FROM competitions;
DROP TABLE competitions;
ALTER TABLE competitions_clean RENAME TO competitions;
CREATE INDEX IF NOT EXISTS idx_competitions_sso_config ON competitions(sso_config_id);
DROP TABLE IF EXISTS soap_workflows;

-- Login throttling must be shared by every Worker isolate, not held in process memory.
CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_expires ON login_attempts(expires_at);
