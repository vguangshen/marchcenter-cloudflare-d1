ALTER TABLE competitions ADD COLUMN manual_credential_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE competitions
SET manual_credential_enabled = 1
WHERE account_api_id IS NOT NULL
  AND TRIM(COALESCE(account_db_provider, '')) <> ''
  AND TRIM(COALESCE(account_db_name, '')) <> ''
  AND TRIM(COALESCE(account_table_name, '')) <> ''
  AND TRIM(COALESCE(account_username_column, '')) <> ''
  AND TRIM(COALESCE(account_password_column, '')) <> ''
  AND TRIM(COALESCE(account_password_algorithm, '')) <> '';
