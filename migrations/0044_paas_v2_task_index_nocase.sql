-- Match the case-insensitive platform and task codes used by batch import.
DROP INDEX IF EXISTS idx_competitions_paas_v2_platform_task;
CREATE INDEX idx_competitions_paas_v2_platform_task
ON competitions (paas_v2_software_unique COLLATE NOCASE, paas_v2_plug_flag COLLATE NOCASE)
WHERE sso_method = 'paasV2';
