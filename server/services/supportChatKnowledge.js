import { createHash } from 'node:crypto';
import pool from '../config/db.js';
import { getRuntime } from '../config/runtime.js';
import builtins from '../data/supportChatKnowledge.js';
import { buildSupportIntentIndex, isSupportIntentFollowUp, recognizeSupportIntent } from '../utils/supportChatIntent.js';

const BUILTINS = new Map(builtins.map(item => {
    const revision = createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 20);
    const entry = { keywords: [], examples: [], followUp: '', ...item, enabled: true, builtin: true, revision: `builtin-${revision}` };
    return [entry.id, entry];
}));
const snapshots = new WeakMap();
const sortText = new Intl.Collator('zh-CN');

export function knowledgeQuestionKey(value) {
    return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

async function readRevision() {
    const [[row]] = await pool.query('SELECT revision FROM support_chat_knowledge_revision WHERE id = 1');
    return row.revision;
}

function entryFromRow(row) {
    return {
        id: row.id,
        category: row.category,
        question: row.question,
        answer: row.answer,
        examples: JSON.parse(row.examples_json),
        keywords: JSON.parse(row.keywords_json),
        followUp: row.follow_up,
        enabled: Boolean(row.enabled),
        builtin: BUILTINS.has(row.id),
        revision: row.revision
    };
}

async function loadSnapshot() {
    const entries = new Map(BUILTINS);
    for (let cursor = ''; ; ) {
        const [rows] = await pool.query('SELECT * FROM support_chat_knowledge WHERE id > ? ORDER BY id LIMIT 100', [cursor]);
        for (const row of rows) entries.set(row.id, entryFromRow(row));
        if (rows.length < 100) break;
        cursor = rows.at(-1).id;
    }
    const ordered = [...entries.values()].sort((a, b) => sortText.compare(a.category, b.category) || sortText.compare(a.question, b.question) || a.id.localeCompare(b.id));
    const active = ordered.filter(entry => entry.enabled);
    return {
        entries: ordered, byId: entries,
        categories: [...new Set(ordered.map(entry => entry.category))],
        summary: { intents: ordered.length, enabled: active.length, examples: ordered.reduce((count, entry) => count + entry.examples.length, 0) },
        index: buildSupportIntentIndex(active)
    };
}

export async function readSupportKnowledge() {
    // D1 remains the authority across Worker isolates. Only reuse an index
    // after checking the revision updated with every accepted operator edit.
    const database = getRuntime().env.DB;
    let revision = await readRevision();
    for (let attempt = 0; attempt < 3; attempt++) {
        const cached = snapshots.get(database);
        if (cached?.revision === revision) return cached.snapshot;

        const snapshot = await loadSnapshot();
        const current = await readRevision();
        if (current === revision) {
            snapshots.set(database, { revision, snapshot });
            return snapshot;
        }
        revision = current;
    }
    throw Object.assign(new Error('客服语料正在更新，请稍后重试'), { status: 503 });
}

export async function writeSupportKnowledge(entry, editorId, expectedRevision) {
    const revision = crypto.randomUUID();
    const key = knowledgeQuestionKey(entry.question);
    const [updated] = await pool.batch([
        [
            `INSERT INTO support_chat_knowledge (id, category, question, question_key, answer, examples_json, keywords_json, follow_up, enabled, revision, updated_by)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM support_chat_knowledge WHERE question_key = ? AND id <> ?)
             ON CONFLICT(id) DO UPDATE SET category = excluded.category, question = excluded.question,
                question_key = excluded.question_key, answer = excluded.answer,
                examples_json = excluded.examples_json, keywords_json = excluded.keywords_json, follow_up = excluded.follow_up,
                enabled = excluded.enabled, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
             WHERE support_chat_knowledge.revision = ?`,
            [entry.id, entry.category, entry.question, key, entry.answer, JSON.stringify(entry.examples), JSON.stringify(entry.keywords),
                entry.followUp, entry.enabled ? 1 : 0, revision, editorId, key, entry.id, expectedRevision || '']
        ],
        ['UPDATE support_chat_knowledge_revision SET revision = ? WHERE id = 1 AND changes() > 0', [revision]]
    ]);
    return updated.affectedRows ? { ...entry, revision } : null;
}

export function recognizeKnowledge(text, snapshot, contextIntentId) {
    const context = contextIntentId ? snapshot.byId.get(contextIntentId) : null;
    if (context?.enabled && context.followUp && isSupportIntentFollowUp(text)) {
        return { kind: 'match', entry: context, confidence: 1, gap: 1, mode: 'followup' };
    }
    return recognizeSupportIntent(text, snapshot.index, { contextIntentId });
}
