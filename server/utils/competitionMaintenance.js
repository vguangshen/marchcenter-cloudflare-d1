import { isClassDeleteMappingReady } from './accountManagementApi.js';
import {
    readAccountManagementConfig, readAccountManagementConfigs, selectAccountManagementConfig
} from './accountManagementStore.js';
import { validateOfficialTransportAddress } from './officialCompat/cardAddress.js';
import { createConfigCredentialsProvider } from './officialCompat/officialDependencyFactory.js';
import { normalizeRole, ROLES } from './roleAccess.js';
import { defaultSsoAllowsHttp, readDefaultSsoConfigs } from './ssoConfigurations.js';

export const ACCOUNT_CAPABLE_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
]);

export async function readJavaClassDeleteBinding(mapping, lookupService = readAccountManagementConfig) {
    if (!isClassDeleteMappingReady(mapping)) {
        return { reason: '当前未配置 Java 班级删除映射，请先在编辑卡片中开启并填写' };
    }
    const accountApiConfig = await lookupService(mapping.apiId);
    if (!accountApiConfig) return { reason: '该卡片映射绑定的账号管理 API 不存在或已删除' };
    if (!accountApiConfig.enabled) return { reason: '所选账号管理 API 已停用' };
    if (!accountApiConfig.signingSecret) return { reason: '所选账号管理 API 缺少 HMAC 签名密钥' };
    return { mapping, accountApiConfig, reason: null };
}

function requiresPasswordRestore(card) {
    return Boolean(card.manualCredentialActive && card.restoreOriginalPasswordBeforeSso);
}

function passwordRestoreReason(service) {
    if (!service?.enabled || !service.signingSecret) {
        return '恢复免密登录需要可用的账号管理 API，请检查绑定';
    }
    if (!service.databaseConnections || !service.deviceId || !service.publicKey) {
        return '恢复免密登录需要配置账号管理服务的设备及数据库连接';
    }
    return null;
}

export async function attachCompetitionMaintenance(cards, user) {
    const role = normalizeRole(user.role);
    if (role === ROLES.STUDENT) return;
    const supported = cards.filter(card => ACCOUNT_CAPABLE_METHODS.has(card.ssoMethod));
    if (!supported.length) return;

    const [ssoConfigs, accountConfigs] = await Promise.all([
        readDefaultSsoConfigs(),
        supported.some(card => requiresPasswordRestore(card)
            || (card.ssoMethod === 'java' && isClassDeleteMappingReady(card.classDeleteMapping)))
            ? readAccountManagementConfigs({ tolerateMalformed: true }) : []
    ]);
    const lookupService = id => selectAccountManagementConfig(accountConfigs, id);
    const credentialsProvider = createConfigCredentialsProvider();
    const hasCredentials = new Map();
    for (const method of new Set(supported.map(card => card.ssoMethod))) {
        try {
            await credentialsProvider.getCredentials({ method, config: ssoConfigs.get(method)?.config || {} });
            hasCredentials.set(method, true);
        } catch {
            hasCredentials.set(method, false);
        }
    }

    for (const card of supported) {
        const method = card.ssoMethod;
        const isJava = method === 'java';
        const initializeReason = role === ROLES.TEACHER
            ? '需要管理员或超级管理员权限'
            : (isJava ? null : '当前接入方式不支持初始化系统');
        let addressReason = null;
        let loginReason = null;
        try {
            const allowHttp = defaultSsoAllowsHttp(ssoConfigs.get(method)?.config);
            validateOfficialTransportAddress({ method, allowHttp }, { cardUrl: card.url });
        } catch (error) {
            if (error.code === 'OFFICIAL_HTTP_NOT_ALLOWED') {
                loginReason = '该平台使用 HTTP，请先在免密配置中允许 HTTP';
            } else {
                addressReason = '请先在编辑卡片中填写有效的平台地址';
                loginReason = addressReason;
            }
        }
        if (!loginReason && !hasCredentials.get(method)) loginReason = '请先配置平台免密接口凭据';
        card.maintenance = {
            delete: isJava
                ? addressReason ?? (await readJavaClassDeleteBinding(card.classDeleteMapping, lookupService)).reason
                : loginReason,
            repair: loginReason ?? (requiresPasswordRestore(card) ? passwordRestoreReason(lookupService(card.accountApiId)) : null),
            initialize: initializeReason ?? loginReason
        };
    }
}
