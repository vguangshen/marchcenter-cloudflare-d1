import { OfficialCanarySequenceError } from './errors.js';

/**
 * Uses the existing d1_locks table. No schema migration is required.
 * The lease is renewed before each phase and each manual confirmation.
 */
export function createD1CanaryLeaseProvider(options = {}) {
    const pool = options.pool;
    if (!pool || typeof pool.query !== 'function') throw new TypeError('D1 canary lease pool 必须显式注入');
    const clock = options.clock || (() => Date.now());
    const randomUUID = options.randomUUID || (() => crypto.randomUUID());
    const leaseMs = options.leaseMs ?? 30 * 60 * 1000;
    const maxStageExecutionMs = options.maxStageExecutionMs ?? 10 * 60 * 1000;
    if (!Number.isInteger(maxStageExecutionMs) || maxStageExecutionMs < 1) throw new TypeError('maxStageExecutionMs 必须是正整数');
    if (!Number.isInteger(leaseMs) || leaseMs <= maxStageExecutionMs) {
        throw new TypeError('canary leaseMs 必须严格大于单阶段最长执行时间');
    }

    return Object.freeze({
        async acquire({ key = 'OFFICIAL_CANARY_SINGLE_TARGET', runId } = {}) {
            const name = String(key).slice(0, 191);
            if (typeof runId !== 'string' || runId.length === 0) throw new TypeError('canary lease 必须绑定 runId');
            const ownerId = randomUUID();
            const owner = `${runId}:${ownerId}`;
            const now = clock();
            const [rows] = await pool.query(
                `INSERT INTO d1_locks (name, owner, expires_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET
                    owner = excluded.owner,
                    expires_at = excluded.expires_at
                 WHERE d1_locks.expires_at <= ?
                 RETURNING owner, expires_at`,
                [name, owner, now + leaseMs, now]
            );
            if (!Array.isArray(rows) || rows.length !== 1 || rows[0].owner !== owner) {
                throw new OfficialCanarySequenceError('已有另一套 canary 正在执行', {
                    code: 'OFFICIAL_CANARY_LEASE_CONFLICT', status: 409
                });
            }
            return Object.freeze({
                ownerId,
                runId,
                expiresAt: Number(rows[0].expires_at),
                async renew() {
                    const nowValue = clock();
                    const expiresAt = nowValue + leaseMs;
                    const [renewed] = await pool.query(
                        `UPDATE d1_locks SET expires_at = ?
                         WHERE name = ? AND owner = ? AND expires_at > ?
                         RETURNING owner, expires_at`,
                        [expiresAt, name, owner, nowValue]
                    );
                    if (!Array.isArray(renewed) || renewed.length !== 1 || renewed[0].owner !== owner) {
                        throw new OfficialCanarySequenceError('canary lease 已失效，禁止继续请求', {
                            code: 'OFFICIAL_CANARY_LEASE_LOST', status: 409
                        });
                    }
                    return Number(renewed[0].expires_at);
                },
                async release() {
                    const [released] = await pool.query(
                        'DELETE FROM d1_locks WHERE name = ? AND owner = ? RETURNING owner',
                        [name, owner]
                    );
                    return Array.isArray(released) && released.length === 1 && released[0].owner === owner;
                }
            });
        }
    });
}
