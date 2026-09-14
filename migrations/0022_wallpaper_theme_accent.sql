-- Wallpaper accent color computed at ingest time ("落库那一刻") instead
-- of waiting for a visitor's browser to decode the image. The Bing sync
-- computes it server-side by decoding the tiny JPEG preview (jpeg-js +
-- the same deriveImageTheme algorithm the frontend uses); uploads send it
-- from the client (canvas, since the upload preview is WebP and pure-JS
-- WebP decoding is not viable). The site config then carries themeAccent
-- so the login page applies the wallpaper's theme color immediately,
-- before the image has even loaded.
ALTER TABLE wallpaper_library ADD COLUMN theme_accent TEXT;
