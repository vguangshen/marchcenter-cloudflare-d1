-- Reconstructed schema for cloud software-platform management and saved task catalogs.
CREATE TABLE IF NOT EXISTS paas_v2_platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    software_unique TEXT NOT NULL COLLATE NOCASE UNIQUE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT 'violet',
    builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    catalog_sync_status TEXT NOT NULL DEFAULT 'never',
    catalog_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS paas_v2_catalogs (
    platform_id INTEGER PRIMARY KEY REFERENCES paas_v2_platforms(id) ON DELETE CASCADE,
    tasks_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO paas_v2_platforms (software_unique, code, name, builtin, sort_order) VALUES
('KJDZSWRJXT', 'PT0401', '跨境电子商务人机协同产教融合平台', 1, 10),
('scyxcjrh', 'PT0402', '市场营销人机协同通用能力平台', 1, 20),
('kjrjxt09', 'PT0403', '财经人机协同产教融合平台', 1, 30),
('dzswcjrh', 'PT0404', '电子商务人机协同产教融合平台', 1, 40);
