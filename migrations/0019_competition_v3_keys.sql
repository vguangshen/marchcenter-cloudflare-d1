-- Per-card JAVA v3 open-API keys, encrypted server-side (AES-GCM via
-- configSecrets). v3_pub_key_p1 is the caller public key used as the
-- GetTokenInfo identity; v3_pub_key_k1 is the platform public key used to
-- sign v3 requests (DelStudent/DelTeacher/DelGroup).
ALTER TABLE competitions ADD COLUMN v3_pub_key_p1 TEXT;
ALTER TABLE competitions ADD COLUMN v3_pub_key_k1 TEXT;
