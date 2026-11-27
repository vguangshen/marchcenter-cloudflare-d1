-- Keep message IDs and timestamps while allowing file-only messages.
CREATE TABLE support_chat_messages_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES support_chat_conversations(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_role TEXT NOT NULL CHECK (author_role IN ('user', 'staff')),
    body TEXT NOT NULL CHECK (length(body) <= 2000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO support_chat_messages_new (id, conversation_id, author_id, author_role, body, created_at)
    SELECT id, conversation_id, author_id, author_role, body, created_at FROM support_chat_messages;

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'support_chat_messages'), 0))
    WHERE name = 'support_chat_messages_new';

DROP TABLE support_chat_messages;
ALTER TABLE support_chat_messages_new RENAME TO support_chat_messages;
CREATE INDEX idx_support_chat_messages_conversation ON support_chat_messages (conversation_id, id DESC);

CREATE TABLE support_chat_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES support_chat_messages(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0)
);

CREATE INDEX idx_support_chat_attachments_message ON support_chat_attachments (message_id, id);
