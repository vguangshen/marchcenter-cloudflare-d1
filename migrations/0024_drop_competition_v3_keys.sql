-- JAVA v3 open-API keys are removed: the v3 delete-key module is unusable on
-- real platforms (YX030505: DelGroup 302; YT00123: default keys unregistered).
-- Class deletion for JAVA platforms now goes through the account-management
-- API (direct DB delete) instead.
ALTER TABLE competitions DROP COLUMN v3_pub_key_p1;
ALTER TABLE competitions DROP COLUMN v3_pub_key_k1;
