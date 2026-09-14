-- Per-card Java Admin / .NET root credentials. The credential JSON is
-- AES-GCM encrypted by the Worker before it is written to D1.
ALTER TABLE competitions ADD COLUMN admin_entry_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE competitions ADD COLUMN admin_entry_credentials TEXT;
