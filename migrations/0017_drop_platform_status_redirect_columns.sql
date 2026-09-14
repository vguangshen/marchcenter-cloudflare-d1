-- Remove dead redirect columns from user_platform_account_status.
-- The official-compat flow requests a fresh server-side ticket on every card
-- jump; the final URL is returned to the client and no longer persisted.
ALTER TABLE user_platform_account_status DROP COLUMN redirect_url;
ALTER TABLE user_platform_account_status DROP COLUMN redirect_ready_at;
