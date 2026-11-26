-- Support tickets: a user reports a problem with one of their competition or
-- agent cards (or a general issue); administrators reply in a thread. File
-- bodies live in R2 (TICKET_FILES); only their metadata is stored here.
CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    competition_id INTEGER REFERENCES competitions(id) ON DELETE SET NULL,
    -- Card title at submission time, kept if the card is later renamed or removed.
    card_title TEXT,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    -- Unseen staff replies for the submitter / unseen submitter messages for staff.
    user_unread INTEGER NOT NULL DEFAULT 0,
    staff_unread INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_role TEXT NOT NULL CHECK (author_role IN ('user', 'staff', 'system')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, id);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
    uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket ON support_ticket_attachments (ticket_id, message_id);
