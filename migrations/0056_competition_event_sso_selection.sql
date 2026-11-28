-- Keep the provider selection stable across retries, credential rotation and entry.
ALTER TABLE competition_events ADD COLUMN platform_sso_config_id INTEGER;
ALTER TABLE competition_events ADD COLUMN platform_sso_method TEXT;
