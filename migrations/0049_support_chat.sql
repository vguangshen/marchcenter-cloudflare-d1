CREATE TABLE IF NOT EXISTS support_chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    user_unread INTEGER NOT NULL DEFAULT 0,
    staff_unread INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_chat_updated ON support_chat_conversations (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_support_chat_staff_unread ON support_chat_conversations (user_id) WHERE staff_unread > 0;

CREATE TABLE IF NOT EXISTS support_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES support_chat_conversations(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_role TEXT NOT NULL CHECK (author_role IN ('user', 'staff')),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_support_chat_messages_conversation ON support_chat_messages (conversation_id, id DESC);
