import express from '../compat/express.js';
import pool from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();
const MAX_LOGO_BYTES = 100 * 1024;
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

function validateLogo(dataUrl) {
    const value = String(dataUrl || '').trim();
    const match = LOGO_DATA_URL.exec(value);
    if (!match) {
        const error = new Error('仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片');
        error.status = 400;
        throw error;
    }
    const payload = match[2];
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const byteLength = Math.floor(payload.length * 3 / 4) - padding;
    if (byteLength <= 0 || byteLength > MAX_LOGO_BYTES) {
        const error = new Error('Logo 图片不能超过 100KB');
        error.status = 413;
        throw error;
    }
    return value;
}

async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

router.get('/', authMiddleware, adminOnly, async (_req, res) => {
    const [rows] = await pool.query(
        `SELECT id, data_url AS dataUrl, created_at AS createdAt
         FROM logo_library
         ORDER BY id DESC
         LIMIT 100`
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows);
});

router.post('/', authMiddleware, adminOnly, async (req, res) => {
    const dataUrl = validateLogo(req.body?.dataUrl);
    const contentHash = await sha256(dataUrl);
    await pool.query(
        `INSERT OR IGNORE INTO logo_library (data_url, content_hash, created_by, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [dataUrl, contentHash, req.user.id]
    );
    const [[item]] = await pool.query(
        `SELECT id, data_url AS dataUrl, created_at AS createdAt
         FROM logo_library WHERE content_hash = ? LIMIT 1`,
        [contentHash]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(item);
});

export default router;
