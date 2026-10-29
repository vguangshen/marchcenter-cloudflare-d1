-- Platform counts, imports and cascading task deletion filter by this platform key.
CREATE INDEX IF NOT EXISTS idx_competitions_paas_v2_platform_task
ON competitions (paas_v2_software_unique COLLATE NOCASE, paas_v2_plug_flag)
WHERE sso_method = 'paasV2';
