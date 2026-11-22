-- Administrator-chosen passwords (new accounts and resets) are only reminded
-- for a grace period; after this deadline the account is locked until the
-- password is changed. NULL with password_change_recommended = 1 means
-- "enforce now", so accounts flagged before this migration get the full
-- grace period from the moment it is applied.
ALTER TABLE users ADD COLUMN password_change_deadline TEXT;

UPDATE users
SET password_change_deadline = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
WHERE password_change_recommended = 1;
