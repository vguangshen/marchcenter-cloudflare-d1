CREATE INDEX IF NOT EXISTS idx_support_chat_messages_created ON support_chat_messages (created_at, conversation_id);
