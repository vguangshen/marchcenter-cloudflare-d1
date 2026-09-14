import pool from '../config/db.js';

export const CONTENT_TYPES = Object.freeze({
    announcements: 'announcements',
    gifts: 'gifts'
});

export async function getContentRevision(contentType) {
    const [[row]] = await pool.query(
        'SELECT revision FROM content_revisions WHERE content_type = ? LIMIT 1',
        [contentType]
    );
    return Number(row?.revision || 0);
}

export async function bumpContentRevision(contentType) {
    await pool.query(
        `INSERT INTO content_revisions (content_type, revision, updated_at)
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(content_type) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP`,
        [contentType]
    );
    return getContentRevision(contentType);
}
