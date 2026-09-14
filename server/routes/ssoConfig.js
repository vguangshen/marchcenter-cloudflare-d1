import express from '../compat/express.js';
import pool from "../config/db.js";
import { authMiddleware, adminOnly } from "../middleware/auth.js";
import { decodeStoredConfig, encodeStoredConfig, publicConfig } from '../utils/configSecrets.js';
import { getEnv } from '../config/runtime.js';
import {
    validateConfirmedOfficialBaseUrl,
    validateOfficialDirectUrl
} from '../utils/officialCompat/officialJumpConfig.js';
import { resolveOfficialInstance } from '../utils/officialCompat/instanceCatalog.js';

const router = express.Router();
const ALLOWED_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement', 'direct', 'paasV2'
]);

function canonicalOfficialConfig(value = {}) {
    const result = { ...(value || {}) };
    // These were dual-mode/variant UI implementation details. Runtime profile
    // selection is now fixed by method and the card supplies the only address.
    delete result.adapterMode;
    delete result.instanceVariant;
    if (result.canaryOnly !== true) {
        delete result.officialBaseUrl;
        delete result.officialBaseUrlConfirmed;
    }
    return result;
}

export function validateConfig(parsed) {
    if (!ALLOWED_METHODS.has(String(parsed?.method || ''))) {
        const error = new Error('不支持的新版免密接口类型');
        error.status = 400;
        throw error;
    }
    resolveOfficialInstance(parsed);
    // The card's jump-link field is the sole visible official address. A
    // template may be saved before any card is bound to it.
    if (parsed.officialBaseUrl !== undefined && parsed.officialBaseUrl !== null && parsed.officialBaseUrl !== '') {
        if (parsed.method === 'direct') validateOfficialDirectUrl(parsed.officialBaseUrl);
        else validateConfirmedOfficialBaseUrl(parsed.officialBaseUrl);
    }
}

// 管理员配置页读取当前服务端默认凭据；仅管理员可见。
router.get('/defaults', authMiddleware, adminOnly, async (req, res) => {
    res.json({
        java: {
            configured: Boolean((getEnv('ITMC_PLATFORM_TOKEN_NUMBER') || getEnv('TOKEN_NUMBER_VERIFICATION_SOFT')) &&
                (getEnv('ITMC_PLATFORM_TOKEN_PASSWORD') || getEnv('PASSWORD_VERIFICATION_SOFT')))
        },
        soap: {
            configured: Boolean(getEnv('SOAP_CLIENT_USERNAME') && getEnv('SOAP_CLIENT_PASSWORD')),
            ticketType: getEnv('SOAP_TICKET_TYPE', 'itmc'),
            hasStudentInitialPassword: Boolean(getEnv('SOAP_STUDENT_INITIAL_PASSWORD'))
        }
    });
});

// 获取所有 SSO 配置
router.get('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM sso_configs ORDER BY id DESC");

        const formatted = rows.map(r => {
            const storedConfig = typeof r.config_data === 'string'
                ? JSON.parse(r.config_data || '{}')
                : { ...(r.config_data || {}) };
            const plaintextSecretFields = [
                'tokenNumber', 'tokenPassword', 'soapUsername', 'soapPassword',
                'studentInitialPassword', 'secretKey', 'password'
            ];
            const needsMigration = plaintextSecretFields.some(key => Boolean(storedConfig[key]));
            const decoded = canonicalOfficialConfig(decodeStoredConfig({
                ...storedConfig
            }));
            const protectedConfig = needsMigration ? encodeStoredConfig(decoded) : storedConfig;
            const configDataStr = JSON.stringify(publicConfig(decoded), null, 2);
            if (needsMigration) {
                pool.query('UPDATE sso_configs SET config_data = ? WHERE id = ?',
                    [JSON.stringify(protectedConfig), r.id]).catch(() => {});
            }

            return {
                id: r.id,
                name: r.name,
                baseUrl: r.base_url,
                configData: configDataStr
            };
        });

        res.json(formatted);
    } catch (err) {
        console.error("Get SSO Config Error:", err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// Passwords are not included in the configuration list. An administrator must
// explicitly request a one-time, non-cacheable reveal before editing them.
router.post('/:id/reveal-secrets', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [[existing]] = await pool.query('SELECT config_data FROM sso_configs WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'SSO 配置不存在' });
        const decoded = decodeStoredConfig(existing.config_data || {});
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.json({
            tokenPassword: decoded.tokenPassword || '',
            soapPassword: decoded.soapPassword || '',
            studentInitialPassword: decoded.studentInitialPassword || ''
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 新增配置
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    const { name, baseUrl, configData } = req.body;

    let parsed;
    try {
        parsed = canonicalOfficialConfig(typeof configData === 'string' ? JSON.parse(configData) : (configData || {}));
    } catch { return res.status(400).json({ error: '配置 JSON 格式无效' }); }

    try {
        validateConfig(parsed);
        if (parsed.canaryOnly !== true) {
            const [rows] = await pool.query('SELECT id, config_data FROM sso_configs ORDER BY id DESC');
            const duplicate = rows.find(row => {
                try {
                    const candidate = decodeStoredConfig(row.config_data || {});
                    return candidate.method === parsed.method && candidate.canaryOnly !== true;
                } catch { return false; }
            });
            if (duplicate) {
                const error = new Error('每种接入方式只保留一份配置，请直接编辑并保存当前配置');
                error.status = 409;
                throw error;
            }
        }
        const [result] = await pool.query(
            "INSERT INTO sso_configs (name, base_url, config_data) VALUES (?, ?, ?)",
            [name, baseUrl, JSON.stringify(encodeStoredConfig(parsed))]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error("Add SSO Config Error:", err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 更新配置
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    const { name, baseUrl, configData } = req.body;

    let parsed;
    try {
        parsed = canonicalOfficialConfig(typeof configData === 'string' ? JSON.parse(configData) : (configData || {}));
    } catch { return res.status(400).json({ error: '配置 JSON 格式无效' }); }

    try {
        validateConfig(parsed);
        const [[existing]] = await pool.query('SELECT config_data FROM sso_configs WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'SSO 配置不存在' });
        const protectedConfig = encodeStoredConfig(
            parsed,
            canonicalOfficialConfig(decodeStoredConfig(existing.config_data || {}))
        );
        const [result] = await pool.query(
            "UPDATE sso_configs SET name=?, base_url=?, config_data=? WHERE id=?",
            [name, baseUrl, JSON.stringify(protectedConfig), req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'SSO 配置不存在' });
        await pool.query(
            `DELETE FROM user_workflow_status
             WHERE competition_id IN (SELECT id FROM competitions WHERE sso_config_id = ?)`,
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Update SSO Config Error:", err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 删除配置
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [[reference]] = await pool.query('SELECT id FROM competitions WHERE sso_config_id = ? LIMIT 1', [req.params.id]);
        if (reference) return res.status(409).json({ error: '该配置仍被竞赛卡片引用，请先修改卡片配置' });
        const [result] = await pool.query("DELETE FROM sso_configs WHERE id=?", [req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'SSO 配置不存在' });
        res.json({ success: true });
    } catch (err) {
        console.error("Delete SSO Config Error:", err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

export default router;
