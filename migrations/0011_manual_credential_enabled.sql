ALTER TABLE competitions
ADD COLUMN manual_credential_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE competitions
SET manual_credential_enabled = 1
WHERE account_api_id IS NOT NULL
  AND account_db_provider IS NOT NULL AND TRIM(account_db_provider) <> ''
  AND account_db_name IS NOT NULL AND TRIM(account_db_name) <> ''
  AND account_table_name IS NOT NULL AND TRIM(account_table_name) <> ''
  AND account_username_column IS NOT NULL AND TRIM(account_username_column) <> ''
  AND account_password_column IS NOT NULL AND TRIM(account_password_column) <> ''
  AND account_password_algorithm IS NOT NULL AND TRIM(account_password_algorithm) <> '';
