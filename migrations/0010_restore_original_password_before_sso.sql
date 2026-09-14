ALTER TABLE competitions
ADD COLUMN restore_original_password_before_sso INTEGER NOT NULL DEFAULT 0;

