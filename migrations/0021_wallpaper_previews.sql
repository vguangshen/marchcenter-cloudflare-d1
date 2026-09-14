-- Low-res preview images for instant first paint. The preview is a tiny
-- (40-100px, a few KB) version of the wallpaper generated once at ingest
-- time: Bing syncs fetch a small variant from Bing's own URL resize
-- parameters, uploads generate it client-side (canvas -> WebP) and send it
-- alongside the full image. The Worker serves it from
-- /api/wallpapers/{id}/preview?v=<preview_hash> with the same strict
-- canonicalization + Cache API pipeline as the content image, so cold
-- visitors see a blurred preview immediately instead of waiting for the
-- ~700KB full image. Rows without a preview (legacy) keep working: the
-- endpoint returns 404 and the frontend falls back to the full image.
ALTER TABLE wallpaper_library ADD COLUMN preview_hash TEXT;
ALTER TABLE wallpaper_library ADD COLUMN preview_type TEXT;
ALTER TABLE wallpaper_library ADD COLUMN preview_byte_size INTEGER;

CREATE INDEX IF NOT EXISTS idx_wallpaper_library_preview_hash
  ON wallpaper_library(preview_hash)
  WHERE preview_hash IS NOT NULL;
