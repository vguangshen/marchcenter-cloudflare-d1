-- 用户登录地理位置：基于 Cloudflare request.cf（由边缘按 IP 推断，城市级精度）。
-- 登录成功与设备上报时更新 users 上的"最新位置"；历史登录位置单独记录。
ALTER TABLE users ADD COLUMN last_latitude REAL;
ALTER TABLE users ADD COLUMN last_longitude REAL;
ALTER TABLE users ADD COLUMN last_city TEXT;
ALTER TABLE users ADD COLUMN last_country_code TEXT;
ALTER TABLE users ADD COLUMN last_region TEXT;
ALTER TABLE users ADD COLUMN last_timezone TEXT;
ALTER TABLE users ADD COLUMN last_organization TEXT;

-- 登录位置历史：管理员可查看某账号最近从哪些地点登录（登录成功时写入）。
CREATE TABLE IF NOT EXISTS user_login_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    latitude REAL,
    longitude REAL,
    city TEXT,
    country_code TEXT,
    region TEXT,
    timezone TEXT,
    organization TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_login_locations_user
  ON user_login_locations(user_id, created_at DESC);
