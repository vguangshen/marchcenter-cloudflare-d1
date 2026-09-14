CREATE TABLE IF NOT EXISTS wallpaper_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('bing', 'upload')),
  source_date TEXT,
  title TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallpaper_library_bing_date
  ON wallpaper_library(source_type, source_date)
  WHERE source_type = 'bing' AND source_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallpaper_library_created_at
  ON wallpaper_library(created_at DESC, id DESC);
