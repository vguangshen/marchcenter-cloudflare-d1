import { CANARY_CONFIRMATION_WORD, validateCanarySpecification } from './canaryGate.js';
import { OfficialCanaryGateError } from './errors.js';
import { fingerprintCanaryPlan } from './planFingerprint.js';

const AUTH_PREFIX = 'OFFICIAL_CANARY_AUTH:';

function randomToken(randomBytes) {
    const bytes = randomBytes ? randomBytes(32) : crypto.getRandomValues(new Uint8Array(32));
    if (!(bytes instanceof Uint8Array) || bytes.length < 32) throw new TypeError('canary authorization randomBytes 至少返回 32 bytes');
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function authorizationOwner({ runId, fingerprint, createdAt }) {
    return JSON.stringify({ runId, fingerprint, createdAt });
}

export function createD1CanaryAuthorizationProvider(options = {}) {
    const pool = options.pool;
    if (!pool || typeof pool.query !== 'function') throw new TypeError('D1 canary authorization pool 必须显式注入');
    const clock = options.clock || (() => Date.now());
    const randomUUID = options.randomUUID || (() => crypto.randomUUID());
    const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    if (!Number.isInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 10 * 60 * 1000) {
        throw new TypeError('canary authorization ttlMs 必须在 30 秒至 10 分钟之间');
    }

    return Object.freeze({
        async issue(input) {
            const specification = validateCanarySpecification(input);
            if (input.confirmationWord !== CANARY_CONFIRMATION_WORD) {
                throw new OfficialCanaryGateError('人工确认文本不匹配');
            }
            const runId = randomUUID();
            const createdAt = clock();
            const expiresAt = createdAt + ttlMs;
            const fingerprint = await fingerprintCanaryPlan(specification);
            const token = randomToken(options.randomBytes);
            const tokenHash = await sha256Hex(token);
            const owner = authorizationOwner({ runId, fingerprint, createdAt });
            await pool.query(
                "DELETE FROM d1_locks WHERE name GLOB 'OFFICIAL_CANARY_AUTH:*' AND expires_at <= ?",
                [createdAt]
            );
            const [rows] = await pool.query(
                `INSERT INTO d1_locks (name, owner, expires_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO NOTHING
                 RETURNING owner`,
                [`${AUTH_PREFIX}${tokenHash}`, owner, expiresAt]
            );
            if (!Array.isArray(rows) || rows.length !== 1) {
                throw new OfficialCanaryGateError('无法签发唯一 canary authorization', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_ISSUE_FAILED'
                });
            }
            return Object.freeze({ token, runId, fingerprint, createdAt, expiresAt });
        },

        async consume({ authorization, specification: input }) {
            if (!authorization || typeof authorization.token !== 'string' || authorization.token.length === 0) {
                throw new OfficialCanaryGateError('缺少一次性 canary authorization', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_REQUIRED'
                });
            }
            const specification = validateCanarySpecification(input, { requireConfirmation: false });
            const currentFingerprint = await fingerprintCanaryPlan(specification);
            const tokenHash = await sha256Hex(authorization.token);
            // Delete first: every presentation is one-shot, including wrong-config and expired attempts.
            const [rows] = await pool.query(
                'DELETE FROM d1_locks WHERE name = ? RETURNING owner, expires_at',
                [`${AUTH_PREFIX}${tokenHash}`]
            );
            if (!Array.isArray(rows) || rows.length !== 1) {
                throw new OfficialCanaryGateError('canary authorization 无效或已使用', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_INVALID'
                });
            }
            let stored;
            try { stored = JSON.parse(rows[0].owner); }
            catch {
                throw new OfficialCanaryGateError('canary authorization 绑定损坏', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_INVALID'
                });
            }
            const now = clock();
            if (Number(rows[0].expires_at) <= now || Number(authorization.expiresAt) <= now) {
                throw new OfficialCanaryGateError('canary authorization 已过期', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_EXPIRED'
                });
            }
            if (stored.runId !== authorization.runId
                || stored.fingerprint !== authorization.fingerprint
                || stored.createdAt !== authorization.createdAt
                || currentFingerprint !== stored.fingerprint) {
                throw new OfficialCanaryGateError('canary plan 已变化或 authorization 绑定不匹配', {
                    code: 'OFFICIAL_CANARY_AUTHORIZATION_PLAN_MISMATCH'
                });
            }
            return Object.freeze({
                runId: stored.runId,
                fingerprint: stored.fingerprint,
                createdAt: stored.createdAt,
                consumedAt: now
            });
        }
    });
}
