import express from '../compat/express.js';
import pool, { getDatabaseConfig, testDatabaseConfig } from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.get('/status', authMiddleware, adminOnly, async (_req, res) => {
    const started = Date.now();
    try {
        const [[versionRows], [tableRows]] = await Promise.all([
            pool.query("SELECT 'D1 SQLite' AS version, 'marchcenter-db' AS databaseName"),
            pool.query("SELECT COUNT(*) AS tableCount FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        ]);
        res.json({
            connected: true,
            latencyMs: Date.now() - started,
            ...getDatabaseConfig(),
            ...versionRows[0],
            serverHost: 'Cloudflare D1',
            tableCount: Number(tableRows[0]?.tableCount || 0),
            sizeMb: null
        });
    } catch (error) {
        res.status(503).json({ connected: false, ...getDatabaseConfig(), error: error.message });
    }
});

router.post('/test', authMiddleware, adminOnly, async (_req, res) => {
    try {
        const result = await testDatabaseConfig();
        res.json({ success: true, latencyMs: result.latencyMs, version: result.version, databaseName: result.databaseName });
    } catch (error) {
        res.status(503).json({ success: false, error: error.message || 'D1 连接测试失败' });
    }
});

router.put('/config', authMiddleware, adminOnly, async (_req, res) => {
    res.status(400).json({
        success: false,
        error: 'D1 连接由 wrangler.jsonc 中的 DB binding 管理，网页端不能修改主机、端口或密码'
    });
});

function identifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer);
        return `X'${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}'`;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `'${text.replace(/'/g, "''")}'`;
}

const BACKUP_TABLES = [
    'users', 'classes', 'sso_configs', 'competitions',
    'system_configs', 'login_attempts', 'd1_locks',
    'logo_library', 'user_manual_teacher_credentials', 'wallpaper_library',
    'login_verification_codes', 'registration_verification_codes',
    'content_revisions', 'user_workflow_status', 'user_access_policies',
    'user_permissions', 'user_competition_time_rules',
    'user_platform_account_status', 'user_competition_student_accounts',
    'user_competition_expert_accounts', 'user_competition_expert_student_bindings',
    'announcements', 'user_gifts', 'ai_settings'
];

router.post('/backup', authMiddleware, adminOnly, async (_req, res) => {
    try {
        const maxBytes = 20 * 1024 * 1024;
        const encoder = new TextEncoder();
        const chunks = [];
        let byteLength = 0;
        const append = chunk => {
            byteLength += encoder.encode(chunk).byteLength;
            if (byteLength > maxBytes) {
                throw new Error('在线数据备份超过 20MB，请使用 npm run db:export:remote 导出完整 D1 数据');
            }
            chunks.push(chunk);
        };
        append('-- MarchCenter Cloudflare D1 data backup\n');
        append('-- Apply all D1 migrations before importing this file.\n');
        append(`-- Generated: ${new Date().toISOString()}\n`);
        append('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n');
        for (const tableName of BACKUP_TABLES) {
            let offset = 0;
            let names = null;
            while (true) {
                const [rows] = await pool.query(
                    `SELECT * FROM ${identifier(tableName)} LIMIT ? OFFSET ?`,
                    [250, offset]
                );
                if (!rows.length) break;
                if (!names) {
                    names = Object.keys(rows[0]);
                    append(`DELETE FROM ${identifier(tableName)};\n`);
                }
                for (let index = 0; index < rows.length; index += 100) {
                    const batch = rows.slice(index, index + 100);
                    append(
                    `INSERT INTO ${identifier(tableName)} (${names.map(identifier).join(', ')}) VALUES\n` +
                    batch.map(row => `(${names.map(name => sqlValue(row[name])).join(', ')})`).join(',\n') +
                    ';\n\n'
                    );
                }
                offset += rows.length;
                if (rows.length < 250) break;
            }
        }
        append('COMMIT;\nPRAGMA foreign_keys=ON;\n');
        const output = chunks.join('');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/sql; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="marchcenter-d1-data-${timestamp}.sql"`);
        res.send(output);
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: error.message || 'D1 数据备份失败' });
    }
});

export default router;
