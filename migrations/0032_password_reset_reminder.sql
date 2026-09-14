ALTER TABLE users RENAME COLUMN must_change_password TO password_change_recommended;
ALTER TABLE users DROP COLUMN temporary_password_expires_at;
