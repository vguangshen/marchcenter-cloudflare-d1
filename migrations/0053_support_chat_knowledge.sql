CREATE TABLE support_chat_knowledge (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    question_key TEXT NOT NULL UNIQUE,
    answer TEXT NOT NULL,
    examples_json TEXT NOT NULL CHECK (json_valid(examples_json)),
    keywords_json TEXT NOT NULL CHECK (json_valid(keywords_json)),
    follow_up TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    revision TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE support_chat_knowledge_revision (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision TEXT NOT NULL
);

INSERT INTO support_chat_knowledge_revision (id, revision) VALUES (1, 'initial');

ALTER TABLE support_chat_messages ADD COLUMN knowledge_json TEXT CHECK (knowledge_json IS NULL OR json_valid(knowledge_json));
