import pool from '../config/db.js';

const TOKEN_TTL_MS = 30_000;

function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
    const bytes = new TextEncoder().encode(String(token || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function issueAdminEntryLaunchToken({ userId, competitionId, now = Date.now() }) {
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const expiresAt = now + TOKEN_TTL_MS;
    await pool.batch([
        ['DELETE FROM admin_entry_launch_tokens WHERE expires_at <= ?', [now]],
        [
            `INSERT INTO admin_entry_launch_tokens
                (token_hash, user_id, competition_id, expires_at)
             VALUES (?, ?, ?, ?)`,
            [tokenHash, userId, competitionId, expiresAt]
        ]
    ]);
    return Object.freeze({ token, expiresAt });
}

export async function consumeAdminEntryLaunchToken(token, { now = Date.now() } = {}) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
    const tokenHash = await hashToken(token);
    const [rows] = await pool.query(
        `DELETE FROM admin_entry_launch_tokens
         WHERE token_hash = ? AND expires_at > ?
         RETURNING user_id AS userId, competition_id AS competitionId, expires_at AS expiresAt`,
        [tokenHash, now]
    );
    return rows[0] || null;
}
