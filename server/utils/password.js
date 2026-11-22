import { getEnv } from '../config/runtime.js';

// Administrator resets set this well-known password. Accounts holding an
// administrator-chosen password (reset or initial) are reminded to change it
// and are locked once the grace period ends (see authMiddleware).
export const ADMIN_RESET_DEFAULT_PASSWORD = '123456';
export const PASSWORD_CHANGE_GRACE_DAYS = 7;

export function passwordChangeDeadline(now = Date.now()) {
    return new Date(now + PASSWORD_CHANGE_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// A flagged account without a recorded deadline is enforced immediately.
export function isPasswordChangeEnforced(recommended, deadline, now = Date.now()) {
    if (!Number(recommended)) return false;
    const due = deadline ? Date.parse(deadline) : NaN;
    return !Number.isFinite(due) || now >= due;
}

const encoder = new TextEncoder();
const DEFAULT_ITERATIONS = 100_000;
// Cloudflare's Web Crypto rejects PBKDF2 above 100,000 iterations in
// production (local workerd does not), so never hash beyond that.
const MAX_WORKERS_ITERATIONS = 100_000;

function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function safeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
    return difference === 0;
}

async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations
    }, key, 256);
    return new Uint8Array(bits);
}

export async function hashPassword(password) {
    const value = String(password);
    if (value.length < 6 || value.length > 128) throw new Error('密码长度必须为 6–128 个字符');
    const configured = Number(getEnv('PBKDF2_ITERATIONS', DEFAULT_ITERATIONS));
    const iterations = Math.min(MAX_WORKERS_ITERATIONS, Math.max(50_000, Number.isFinite(configured) ? configured : DEFAULT_ITERATIONS));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(value, salt, iterations);
    return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password, encoded) {
    const parts = String(encoded || '').split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2_000_000) return false;
    try {
        const salt = fromBase64(parts[2]);
        const expected = fromBase64(parts[3]);
        const actual = await derive(String(password), salt, iterations);
        return safeEqual(actual, expected);
    } catch {
        return false;
    }
}
