-- Optional administrator-supplied original password ciphertext. This is
-- already the target platform's password ciphertext and is stored as entered.
ALTER TABLE competitions
ADD COLUMN restore_original_password_ciphertext TEXT;
