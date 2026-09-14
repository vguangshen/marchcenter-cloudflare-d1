UPDATE users
SET email = lower(trim(email))
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
ON users(email COLLATE NOCASE)
WHERE email IS NOT NULL AND trim(email) <> '';
