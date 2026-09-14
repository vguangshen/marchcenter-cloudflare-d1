import crypto from 'crypto';
import pool from '../config/db.js';
import { getEnv } from '../config/runtime.js';
import { authMiddleware } from '../middleware/auth.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { initializePlatformModule } from '../utils/platformJumpDispatcher.js';
import { normalizeRole, ROLES } from '../utils/roleAccess.js';

const MODULE_INIT_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MODULE_INIT_TIMEOUT_MS = 120_000;

function moduleInitTimeoutMs() {
    const configured = Number(getEnv('SSO_MODULE_INIT_TIMEOUT_MS'));
    return Number.isFinite(configured) && configured >= 30_000 && configured <= 300_000
        ? configured
        : DEFAULT_MODULE_INIT_TIMEOUT_MS;
}

function moduleInitializerOnly(req, res, next) {
    const role = normalizeRole(req.user?.role);
    if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(role)) {
        return res.status(403).json({ error: '需要管理员或超级管理员权限' });
    }
    next();
}

export function attachSsoModuleInitRoutes(router, { resolvePlatformConfig, officialDependencyOverrides }) {
    router.post('/module/init/confirm', authMiddleware, moduleInitializerOnly, async (req, res) => {
        try {
            const competitionId = Number(req.body?.competitionId);
            if (!Number.isInteger(competitionId) || competitionId < 1) {
                return res.status(400).json({ error: '竞赛卡片无效' });
            }
            const [cards] = await pool.query(
                'SELECT sso_method AS ssoMethod FROM competitions WHERE id = ?',
                [competitionId]
            );
            if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
            if (cards[0].ssoMethod !== 'java') {
                return res.status(400).json({ error: '当前接入方式不支持模块初始化' });
            }

            const token = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const expiresAt = new Date(Date.now() + MODULE_INIT_TOKEN_TTL_MS).toISOString();
            await pool.query(
                `INSERT INTO module_init_confirmations (competition_id, token_hash, expires_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(competition_id) DO UPDATE SET
                     token_hash = excluded.token_hash,
                     expires_at = excluded.expires_at,
                     created_at = CURRENT_TIMESTAMP`,
                [competitionId, tokenHash, expiresAt]
            );
            return res.json({ success: true, confirmToken: token, expiresAt });
        } catch (error) {
            console.error('[SSO] 申请模块初始化令牌失败：', error.message);
            return res.status(500).json({ error: error.message || '申请模块初始化令牌失败' });
        }
    });

    router.post('/module/init', authMiddleware, moduleInitializerOnly, async (req, res) => {
        try {
            const competitionId = Number(req.body?.competitionId);
            if (!Number.isInteger(competitionId) || competitionId < 1) {
                return res.status(400).json({ error: '竞赛卡片无效' });
            }
            await assertCompetitionAccess(req.user, competitionId);
            const [cards] = await pool.query(
                `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType
                 FROM competitions WHERE id = ?`,
                [competitionId]
            );
            if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
            const card = cards[0];
            if (card.ssoMethod !== 'java') {
                return res.status(400).json({ error: '当前接入方式不支持模块初始化' });
            }

            const providedToken = typeof req.body?.confirmToken === 'string' && req.body.confirmToken.trim() !== ''
                ? req.body.confirmToken.trim()
                : '';
            if (!providedToken) {
                return res.status(403).json({ error: '缺少模块初始化确认令牌，请先通过 /module/init/confirm 申请' });
            }
            const tokenHash = crypto.createHash('sha256').update(providedToken).digest('hex');
            const [consumed] = await pool.query(
                `DELETE FROM module_init_confirmations
                 WHERE competition_id = ? AND token_hash = ? AND expires_at > ?`,
                [competitionId, tokenHash, new Date().toISOString()]
            );
            if (consumed.affectedRows === 0) {
                return res.status(403).json({ error: '模块初始化确认令牌无效、已过期或已使用' });
            }

            const context = { user: req.user, cardUrl: card.url, loginRole: 'teacher', studentIndex: null };
            const { effectiveConfig } = await resolvePlatformConfig({
                configId: card.ssoConfigId,
                method: card.ssoMethod,
                classType: card.classType
            }, context);
            await initializePlatformModule(effectiveConfig, context, {
                ...officialDependencyOverrides(),
                moduleInitTimeoutMs: moduleInitTimeoutMs()
            });
            await pool.query(
                `INSERT INTO user_class_removals (user_id, competition_id, removed_at)
                 VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(user_id, competition_id) DO UPDATE SET removed_at = CURRENT_TIMESTAMP`,
                [req.user.id, competitionId]
            );
            return res.json({ success: true, initialized: true });
        } catch (error) {
            console.error('[SSO] 模块初始化失败：', error.message);
            const status = Number(error.status) >= 400 && Number(error.status) < 600
                ? Number(error.status)
                : (String(error.code || '').startsWith('OFFICIAL_') ? 502 : 500);
            return res.status(status).json({ error: error.message || '模块初始化失败' });
        }
    });
}
