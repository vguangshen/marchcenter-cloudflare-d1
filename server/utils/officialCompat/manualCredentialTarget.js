import {
    mapMarchCenterToOfficialParameters,
    selectOfficialBaseUrl,
    validateConfirmedOfficialBaseUrl
} from './officialJumpConfig.js';

const ACCOUNT_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
]);

/**
 * Account-management companion target. It shares the official identity mapper
 * so password restoration and SSO always refer to the same remote username.
 */
export function buildManualCredentialTarget(config = {}, context = {}) {
    const method = String(config.method || '');
    if (!ACCOUNT_METHODS.has(method)) {
        throw new Error('当前接入方式不支持提取账号密码');
    }
    const baseUrl = validateConfirmedOfficialBaseUrl(selectOfficialBaseUrl(config, context));
    const parameters = mapMarchCenterToOfficialParameters(config, context, baseUrl);
    if (typeof parameters.loginName !== 'string' || parameters.loginName.length === 0) {
        throw new Error('平台账号不能为空');
    }
    return Object.freeze({
        system: method,
        username: parameters.loginName,
        loginUrl: method === 'java' ? baseUrl : `${baseUrl}/Login.aspx`
    });
}
