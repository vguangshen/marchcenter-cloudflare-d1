ALTER TABLE support_chat_messages ADD COLUMN reply_source TEXT CHECK (reply_source IS NULL OR reply_source IN ('template', 'ai'));
ALTER TABLE support_chat_conversations ADD COLUMN human_requested INTEGER NOT NULL DEFAULT 0 CHECK (human_requested IN (0, 1));
ALTER TABLE support_chat_conversations ADD COLUMN ai_last_request_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_chat_conversations ADD COLUMN ai_request_day TEXT NOT NULL DEFAULT '';
ALTER TABLE support_chat_conversations ADD COLUMN ai_requests_today INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS support_chat_options (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    templates_json TEXT NOT NULL,
    ai_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ai_enabled IN (0, 1))
);
