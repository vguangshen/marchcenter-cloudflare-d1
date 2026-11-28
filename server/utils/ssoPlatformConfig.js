import pool from '../config/db.js';
import { getRuntime } from '../config/runtime.js';
import { mapCardAddressToOfficialConfig } from './officialCompat/cardAddress.js';
import { defaultSsoAllowsHttp, parseSsoConfig, readDefaultSsoConfigs } from './ssoConfigurations.js';

export const ALLOWED_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement', 'direct', 'paasV2'
]);

// The Worker composition root may provide isolate-scoped token stores for
// all requests.  Route/unit tests that do not run inside the Worker runtime
// intentionally receive no override and therefore keep request-local state.
export function officialDependencyOverrides() {
    try {
        const { officialTokenStore, paasV2TokenStore } = getRuntime();
        return { officialTokenStore, paasV2TokenStore };
    } catch {
        return {};
    }
}

export async function resolvePlatformConfig({ configId, method, classType }, context = {}) {
    let record = null;
    let config = null;

    if (method && (method !== 'paasV2' || !configId)) {
        if (!ALLOWED_METHODS.has(method)) {
            const error = new Error('不支持的免密登录方式');
            error.status = 400;
            throw error;
        }
        const resolved = (await readDefaultSsoConfigs()).get(method);
        record = resolved?.record || null;
        config = {
            className: '默认班级',
            teacherUserName: 'teacher',
            roleName: 'student',
            loginRole: 'student',
            flag: '1',
            trainOrExam: 'train',
            classPrefix: 'mc',
            teacherPrefix: 'mc',
            studentPrefix: 'mcs',
            studentSuffix: '1',
            expertPrefix: 'mcpw',
            ...resolved?.config,
            method,
            ...(classType ? { classType: Number(classType) } : {}),
            allowHttp: defaultSsoAllowsHttp(resolved?.config)
        };
    } else if (configId) {
        const [rows] = await pool.query('SELECT * FROM sso_configs WHERE id = ?', [configId]);
        if (!rows.length) {
            const error = new Error('免密登录配置不存在');
            error.status = 404;
            throw error;
        }
        record = rows[0];
        config = { ...parseSsoConfig(record), ...(classType ? { classType: Number(classType) } : {}) };
        if (method === 'paasV2' && config.method !== 'paasV2') {
            throw Object.assign(new Error('该智能体任务绑定了无效的免密配置'), { status: 409 });
        }
        if (config.canaryOnly === true) {
            const error = new Error('专用 canary 配置不能通过普通 SSO 路由执行');
            error.status = 403;
            throw error;
        }
    } else {
        const error = new Error('请选择一种免密登录方式');
        error.status = 400;
        throw error;
    }

    delete config.adapterMode;
    delete config.instanceVariant;
    const storedEffectiveConfig = { ...config, baseUrl: config.baseUrl || record?.base_url || '' };
    const effectiveConfig = context && Object.prototype.hasOwnProperty.call(context, 'cardUrl')
        ? mapCardAddressToOfficialConfig(storedEffectiveConfig, context.cardUrl)
        : storedEffectiveConfig;
    return { record, config, effectiveConfig };
}
