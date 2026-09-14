import pool from '../config/db.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withD1Lock(name, action, { waitMs = 5000, leaseMs = 30000 } = {}) {
    const key = String(name).slice(0, 191);
    const owner = crypto.randomUUID();
    const deadline = Date.now() + waitMs;

    while (Date.now() <= deadline) {
        const now = Date.now();
        // 单条条件 UPSERT：空 key 或已过期 key 才能写入新 owner，
        // 并用 RETURNING 判定唯一胜者，避免每轮轮询三次查询。
        const [rows] = await pool.query(
            `INSERT INTO d1_locks (name, owner, expires_at)
             VALUES (?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
                owner = excluded.owner,
                expires_at = excluded.expires_at
             WHERE d1_locks.expires_at <= ?
             RETURNING owner`,
            [key, owner, now + leaseMs, now]
        );
        if (rows.length === 1 && rows[0].owner === owner) {
            try {
                return await action();
            } finally {
                await pool.query('DELETE FROM d1_locks WHERE name = ? AND owner = ?', [key, owner]).catch(() => {});
            }
        }
        await sleep(100);
    }

    const error = new Error('当前操作正在处理中，请稍后重试');
    error.status = 409;
    throw error;
}
