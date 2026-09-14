-- Ensure all four AI engine parameters are represented in D1, including
-- installations created before maxTokens became a persisted setting.
UPDATE ai_settings
SET config_json = json_set(
  config_json,
  '$.maxTokens',
  COALESCE(json_extract(config_json, '$.maxTokens'), 2000)
)
WHERE id = 1;
