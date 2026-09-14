import { OfficialSoapEndpointError, OfficialSoapSchemaError } from '../errors.js';
import { commerceProfile } from './profiles/commerce.js';
import { crossBorderCommerceProfile } from './profiles/crossBorderCommerce.js';
import { enterpriseManagementProfile } from './profiles/enterpriseManagement.js';
import { managementAccountingProfile } from './profiles/managementAccounting.js';
import { marketingProfile } from './profiles/marketing.js';
import { netProfile } from './profiles/net.js';

const PROFILES = Object.freeze({
    net: netProfile,
    marketing: marketingProfile,
    commerce: commerceProfile,
    managementAccounting: managementAccountingProfile,
    crossBorderCommerce: crossBorderCommerceProfile,
    enterpriseManagement: enterpriseManagementProfile
});

export function getSoapProfile(profileName) {
    const profile = PROFILES[profileName];
    if (!profile) throw new OfficialSoapSchemaError(`未注册 SOAP profile: ${profileName}`);
    return profile;
}

export function getSoapOperation(profileName, operationName) {
    const profile = getSoapProfile(profileName);
    const operation = profile.operations.find(item => item.operationName === operationName);
    if (!operation) throw new OfficialSoapSchemaError(`${profileName} 未注册操作 ${operationName}`);
    return operation;
}

/**
 * Only the confirmed base-URL form is accepted. URL safety/SSRF policy remains
 * an outer-layer responsibility and is intentionally not duplicated here.
 */
export function buildConfirmedAxisEndpoint(baseUrl) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        throw new OfficialSoapEndpointError('SOAP base URL 不能为空');
    }
    let parsed;
    try {
        parsed = new URL(baseUrl);
    } catch (cause) {
        throw new OfficialSoapEndpointError('SOAP base URL 格式无效', { cause });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new OfficialSoapEndpointError('SOAP base URL 不是已确认的 HTTP(S) base URL 形式');
    }
    if (parsed.search || parsed.hash || /normwebservice\.asmx/i.test(parsed.pathname) || baseUrl.endsWith('/')) {
        throw new OfficialSoapEndpointError('完整 WSDL/ASMX、查询参数、片段或尾斜杠输入尚未确认，不支持自动裁剪');
    }
    return `${baseUrl}/normwebservice.asmx?WSDL`;
}

export function listSoapProfiles() {
    return Object.values(PROFILES);
}
