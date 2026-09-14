PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'student',
    class_id INTEGER,
    is_disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT,
    last_seen_at TEXT,
    last_ip TEXT,
    user_agent TEXT,
    screen_resolution TEXT,
    device_info TEXT,
    theme_settings TEXT,
    session_revoke_at TEXT,
    session_revoke_before TEXT,
    reset_session_revoke_mode TEXT NOT NULL DEFAULT 'immediate'
);
CREATE INDEX IF NOT EXISTS idx_users_class_id ON users(class_id);
CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at DESC);

CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    teacher_user_id INTEGER NOT NULL UNIQUE,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sso_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT,
    config_data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitions (
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
    account_db_provider TEXT,
    account_db_name TEXT,
    account_table_name TEXT,
    account_username_column TEXT,
    account_password_column TEXT,
    account_password_algorithm TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_competitions_sso_config ON competitions(sso_config_id);

CREATE TABLE IF NOT EXISTS system_configs (
    config_key TEXT PRIMARY KEY,
    config_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    window_started_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_expires ON login_attempts(expires_at);

CREATE TABLE IF NOT EXISTS user_workflow_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, competition_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_competition ON user_workflow_status(competition_id);

CREATE TABLE IF NOT EXISTS user_access_policies (
    user_id INTEGER PRIMARY KEY,
    configured INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    PRIMARY KEY(user_id, competition_id)
);
CREATE INDEX IF NOT EXISTS idx_permission_competition ON user_permissions(competition_id);

CREATE TABLE IF NOT EXISTS user_competition_time_rules (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    unlock_time TEXT,
    lock_time TEXT,
    PRIMARY KEY(user_id, competition_id)
);

CREATE TABLE IF NOT EXISTS user_platform_account_status (
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    login_role TEXT NOT NULL,
    student_index INTEGER NOT NULL DEFAULT 1,
    ready_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    redirect_url TEXT,
    redirect_ready_at TEXT,
    PRIMARY KEY(user_id, competition_id, login_role, student_index)
);
CREATE INDEX IF NOT EXISTS idx_platform_account_competition ON user_platform_account_status(competition_id);

CREATE TABLE IF NOT EXISTS user_competition_student_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    student_index INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, competition_id, student_index)
);
CREATE INDEX IF NOT EXISTS idx_user_card ON user_competition_student_accounts(user_id, competition_id);

CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    link TEXT,
    duration INTEGER NOT NULL DEFAULT 10,
    target_type TEXT NOT NULL DEFAULT 'all',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_gifts (
    id TEXT PRIMARY KEY,
    target_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    type TEXT NOT NULL DEFAULT 'link',
    sent_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gift_target ON user_gifts(target_user_id, is_read);

CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY,
    config_json TEXT NOT NULL,
    encrypted_api_key TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS d1_locks (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_d1_locks_expiry ON d1_locks(expires_at);
