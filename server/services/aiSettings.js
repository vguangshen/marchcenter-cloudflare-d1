import crypto from 'crypto';
import pool from '../config/db.js';
import { getEnv } from '../config/runtime.js';
import { getJwtSecret } from '../middleware/auth.js';

const encryptionKey = () => crypto.createHash('sha256').update(getEnv('SSO_CONFIG_ENCRYPTION_KEY') || getJwtSecret()).digest();

export function encryptAiSecret(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}

export function decryptAiSecret(value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) return '';
    const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function parseConfig(value) {
    if (!value) return {};
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value) || {}; } catch { return {}; }
}

export async function readAiSettings() {
    const [[row]] = await pool.query('SELECT config_json, encrypted_api_key FROM ai_settings WHERE id = 1');
    return {
        config: parseConfig(row?.config_json),
        apiKey: row?.encrypted_api_key ? decryptAiSecret(row.encrypted_api_key) : ''
    };
}
