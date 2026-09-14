import express from '../compat/express.js';
import db from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = express.Router();

// 站点配置决定登录页当前壁纸。Cache API 只在当前数据中心生效，Cron、
// 删除或替换壁纸时无法可靠清理其他节点，因此这里始终读取 D1 并 no-store。
// 配置仅数 KB；以一次轻量 D1 查询换取所有节点一致且不显示已删除/旧壁纸。
const PUBLIC_CACHE_CONTROL = 'no-store';
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_CONFIG_DEPTH = 6;
const MAX_CONFIG_KEYS = 160;
const MAX_TEXT_LENGTH = 4000;
const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'loginTitle', 'loginSubtitle', 'loginBrandName', 'loginVisualTitle', 'loginVisualSubtitle',
    'loginVisualCenterType', 'loginVisualCenterValue', 'loginVisualCenterImageUrl',
    'loginWelcomeTitle', 'loginWelcomeSubtitle', 'loginTextAlign', 'loginPasswordTabText',
    'loginCodeTabText', 'loginUsernameLabel', 'loginUsernamePlaceholder', 'loginCodeAccountLabel',
    'loginCodeAccountPlaceholder', 'loginPasswordLabel', 'loginPasswordPlaceholder', 'loginCodeLabel',
    'loginCodeSendText', 'loginCodeHint', 'loginCodeDisabledHint', 'loginSubmitText',
    'loginCodeSubmitText', 'loginLoadingText', 'loginForgotText', 'loginRegisterLead',
    'loginRegisterText', 'loginSecurityText', 'forgotTitle', 'forgotSubtitle', 'forgotInstruction',
    'forgotCloseText', 'registerTitle', 'registerSubtitle', 'registerSubmitText',
    'registerSuccessTitle', 'registerSuccessSubtitle', 'welcomeTitle', 'welcomeSubtitle',
    'dailyQuote', 'dashboardTextAlign', 'footerText', 'footerSize', 'footerVisibility',
    'navbarLogoType', 'navbarLogoUrl', 'loginLogoType', 'customLogoUrl', 'homeWelcomeTitle',
    'homeSubtitle', 'searchPlaceholder', 'globalTheme'
]);
const ALLOWED_THEME_KEYS = new Set([
    'effectMode', 'manualColor', 'lightDark', 'immersive', 'backgroundMode', 'wallpaperId',
    'wallpaperVersion', 'themeAccent', 'systemEffects'
]);
const ALLOWED_ACCENT_KEYS = new Set(['themeKey', 'rgb']);
const ALLOWED_SYSTEM_EFFECT_KEYS = new Set([
    'loginVisualFloat', 'loginEntrance', 'dashboardCardReveal', 'wallpaperReveal'
]);
const ALLOWED_RICH_TEXT_KEYS = new Set(['text', 'align', 'fontSize']);
const RICH_TEXT_TOP_LEVEL_KEYS = new Set(['loginTitle', 'loginSubtitle', 'homeWelcomeTitle', 'homeSubtitle']);
const EFFECT_MODES = new Set(['default', 'immersive', 'wallpaper', 'color']);
const LIGHT_DARK_MODES = new Set(['auto', 'light', 'dark']);
const BACKGROUND_MODES = new Set(['default', 'bing', 'wallpaper']);
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right']);
const FOOTER_SIZES = new Set(['small', 'medium', 'large']);
const FOOTER_VISIBILITIES = new Set(['all', 'login_only', 'dashboard_only', 'none']);

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateObjectShape(value, { allowedKeys, label, depth = 0 } = {}) {
    if (!isPlainObject(value)) throw Object.assign(new Error(`${label || '配置'}格式无效`), { status: 400 });
    const keys = Object.keys(value);
    if (keys.length > MAX_CONFIG_KEYS) throw Object.assign(new Error('配置字段过多'), { status: 400 });
    for (const key of keys) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
            throw Object.assign(new Error('配置字段无效'), { status: 400 });
        }
        if (allowedKeys && !allowedKeys.has(key)) {
            throw Object.assign(new Error(`${label || '配置'}包含未知字段：${key}`), { status: 400 });
        }
        validateConfigValue(value[key], depth + 1);
    }
}

function validateConfigValue(value, depth) {
    if (depth > MAX_CONFIG_DEPTH) throw Object.assign(new Error('配置嵌套层级过深'), { status: 400 });
    if (value == null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw Object.assign(new Error('配置数值无效'), { status: 400 });
        return;
    }
    if (typeof value === 'string') {
        if (value.length > MAX_TEXT_LENGTH) throw Object.assign(new Error('单个配置文本不能超过 4000 个字符'), { status: 400 });
        return;
    }
    if (Array.isArray(value)) throw Object.assign(new Error('站点配置不接受数组字段'), { status: 400 });
    validateObjectShape(value, { depth });
}

function validateSiteConfig(value) {
    validateObjectShape(value, { allowedKeys: ALLOWED_TOP_LEVEL_KEYS, label: '站点配置' });
    for (const key of RICH_TEXT_TOP_LEVEL_KEYS) {
        if (value[key] == null || typeof value[key] === 'string') continue;
        validateObjectShape(value[key], { allowedKeys: ALLOWED_RICH_TEXT_KEYS, label: `${key} 文案配置`, depth: 1 });
        if (value[key].text != null && typeof value[key].text !== 'string') {
            throw Object.assign(new Error(`${key}.text 必须是文本`), { status: 400 });
        }
        if (value[key].align != null && !TEXT_ALIGNMENTS.has(value[key].align)) {
            throw Object.assign(new Error(`${key}.align 无效`), { status: 400 });
        }
        if (value[key].fontSize != null && typeof value[key].fontSize !== 'string') {
            throw Object.assign(new Error(`${key}.fontSize 必须是文本`), { status: 400 });
        }
    }
    if (value.dashboardTextAlign != null && !TEXT_ALIGNMENTS.has(value.dashboardTextAlign)) {
        throw Object.assign(new Error('首页文字对齐方式无效'), { status: 400 });
    }
    if (value.footerSize != null && !FOOTER_SIZES.has(value.footerSize)) {
        throw Object.assign(new Error('页脚文字大小无效'), { status: 400 });
    }
    if (value.footerVisibility != null && !FOOTER_VISIBILITIES.has(value.footerVisibility)) {
        throw Object.assign(new Error('页脚显示范围无效'), { status: 400 });
    }
    if (value.globalTheme != null) {
        validateObjectShape(value.globalTheme, { allowedKeys: ALLOWED_THEME_KEYS, label: '主题配置', depth: 1 });
        if (value.globalTheme.effectMode != null && !EFFECT_MODES.has(value.globalTheme.effectMode)) {
            throw Object.assign(new Error('主题效果模式无效'), { status: 400 });
        }
        if (value.globalTheme.lightDark != null && !LIGHT_DARK_MODES.has(value.globalTheme.lightDark)) {
            throw Object.assign(new Error('明暗模式无效'), { status: 400 });
        }
        if (value.globalTheme.backgroundMode != null && !BACKGROUND_MODES.has(value.globalTheme.backgroundMode)) {
            throw Object.assign(new Error('背景模式无效'), { status: 400 });
        }
        if (value.globalTheme.wallpaperId != null && (!Number.isInteger(Number(value.globalTheme.wallpaperId)) || Number(value.globalTheme.wallpaperId) < 1)) {
            throw Object.assign(new Error('壁纸编号无效'), { status: 400 });
        }
        if (value.globalTheme.themeAccent != null) {
            validateObjectShape(value.globalTheme.themeAccent, { allowedKeys: ALLOWED_ACCENT_KEYS, label: '主题色配置', depth: 2 });
            if (typeof value.globalTheme.themeAccent.themeKey !== 'string'
                || typeof value.globalTheme.themeAccent.rgb !== 'string'
                || !/^\d{1,3}( \d{1,3}){2}$/.test(value.globalTheme.themeAccent.rgb)) {
                throw Object.assign(new Error('主题色配置无效'), { status: 400 });
            }
        }
        if (value.globalTheme.systemEffects != null) {
            validateObjectShape(value.globalTheme.systemEffects, { allowedKeys: ALLOWED_SYSTEM_EFFECT_KEYS, label: '动画配置', depth: 2 });
            for (const [key, enabled] of Object.entries(value.globalTheme.systemEffects)) {
                if (typeof enabled !== 'boolean') {
                    throw Object.assign(new Error(`动画配置 ${key} 必须是布尔值`), { status: 400 });
                }
            }
        }
    }
    const serialized = JSON.stringify(value);
    if (new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_BYTES) {
        throw Object.assign(new Error('站点配置不能超过 64KB'), { status: 413 });
    }
    return serialized;
}

// 获取全局配置 (公开接口，登录页也要用)
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT config_value FROM system_configs WHERE config_key = ?', ['site_global']);

        let config = {};
        if (rows.length > 0) {
            // D1 stores JSON as text; keep object compatibility for tests/adapters.
            const value = rows[0].config_value;
            if (typeof value === 'string') {
                try { config = JSON.parse(value || '{}'); }
                catch { config = {}; }
            } else {
                config = value;
            }
        }

        // 壁纸被选中时附带内容版本（content_hash）与主题色（theme_accent，
        // 落库时已计算）。版本即内容指纹：新上传 / 未来同 ID 替换内容
        // 都会变化，前端据此生成版本化 URL（/content?v=版本），保证新
        // 内容永远不会命中旧版本的边缘缓存；主题色让登录页在图片加载前
        // 就应用壁纸的配色，不再先闪默认蓝色。
        const wallpaperId = Number(config.globalTheme?.wallpaperId);
        if (Number.isInteger(wallpaperId) && wallpaperId > 0) {
            const [wallpaperRows] = await db.query(
                'SELECT content_hash, theme_accent FROM wallpaper_library WHERE id = ?',
                [wallpaperId]
            );
            if (wallpaperRows.length > 0) {
                let themeAccent = null;
                if (typeof wallpaperRows[0].theme_accent === 'string') {
                    try { themeAccent = JSON.parse(wallpaperRows[0].theme_accent); }
                    catch { themeAccent = null; }
                }
                config.globalTheme = {
                    ...config.globalTheme,
                    wallpaperVersion: wallpaperRows[0].content_hash,
                    themeAccent
                };
            }
        }

        res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
        res.json(config);
    } catch (err) {
        console.error("SiteConfig Get Error:", err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// 保存全局配置 (需要管理员权限，这里复用 authMiddleware)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    const newConfig = req.body;

    try {
        const serializedConfig = validateSiteConfig(newConfig);
        // 使用 SQLite ON CONFLICT 实现“有则更新，无则插入”
        const query = `
            INSERT INTO system_configs (config_key, config_value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = CURRENT_TIMESTAMP
        `;

        await db.query(query, ['site_global', serializedConfig]);

        res.setHeader('Cache-Control', 'no-store');
        res.json({ message: '配置已保存', config: newConfig });
    } catch (err) {
        console.error("SiteConfig Save Error:", err);
        const status = Number(err.status) || 500;
        res.status(status).json({ message: status >= 500 ? 'Server Error' : err.message });
    }
});

export default router;
