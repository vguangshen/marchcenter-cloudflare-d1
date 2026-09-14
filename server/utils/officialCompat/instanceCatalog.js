import { OfficialJumpNotImplementedError } from './errors.js';

/**
 * One evidence-backed executable profile per public platform method. Profile
 * selection is internal: administrators choose the platform type, not a
 * duplicate instance/variant selector.
 */
export const OFFICIAL_INSTANCE_CATALOG = Object.freeze({
    java: Object.freeze({
        id: 'java-new-rest', label: 'JAVA 新版 REST',
        serviceName: 'NewTrainingInterfaceUtilService',
        profileName: 'java', transport: 'HTTP form', evidenceLevel: 'official-captured'
    }),
    net: Object.freeze({
        id: 'net-new-soap', label: '.NET 通用新版 SOAP',
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        profileName: 'netGeneralStandard', transport: 'SOAP 1.1 / Axis', operationCount: 37,
        evidenceLevel: 'official-captured'
    }),
    marketing: Object.freeze({
        id: 'marketing-new-soap', label: '市场营销新版 SOAP',
        serviceName: 'ShichangyingxiaoshapanInterfaceUtilService',
        profileName: 'shapan_shichangyingxiao', transport: 'SOAP 1.1 / Axis', operationCount: 42,
        evidenceLevel: 'official-captured'
    }),
    commerce: Object.freeze({
        id: 'commerce-new-soap', label: '网店运营推广新版 SOAP',
        serviceName: 'WangdianyunyingtuiguangGJshapanInterfaceUtilService',
        profileName: 'shapan_wangdianyunyingtuiguanggaoji', transport: 'SOAP 1.1 / Axis', operationCount: 42,
        evidenceLevel: 'official-captured'
    }),
    managementAccounting: Object.freeze({
        id: 'management-accounting-new-soap', label: '管理会计高级新版 SOAP',
        serviceName: 'GuanlikuaijiGJshapanInterfaceUtilService',
        profileName: 'shapan_guanlikuaijigaoji', transport: 'SOAP 1.1 / Axis', operationCount: 41,
        evidenceLevel: 'official-captured'
    }),
    crossBorderCommerce: Object.freeze({
        id: 'cross-border-new-soap', label: '跨境电商新版 SOAP',
        serviceName: 'KuajingdianshangshapanInterfaceUtilService',
        profileName: 'shapan_kuajingdianshang', transport: 'SOAP 1.1 / Axis', operationCount: 28,
        evidenceLevel: 'official-captured'
    }),
    enterpriseManagement: Object.freeze({
        id: 'enterprise-management-new-soap', label: '企业管理新版 SOAP',
        serviceName: 'QiyeguanlishapanInterfaceUtilService',
        profileName: 'shapan_qiyeguanli', transport: 'SOAP 1.1 / Axis', operationCount: 41,
        evidenceLevel: 'official-captured'
    }),
    paasV2: Object.freeze({
        id: 'paas-v2-agent', label: 'PaaS 新版免密跳转（PT04 智能体）',
        serviceName: 'PaasV2AgentAdapter',
        profileName: 'paasV2', transport: 'HTTP JSON -> POST form', evidenceLevel: 'official-captured'
    }),
    direct: Object.freeze({
        id: 'direct-url', label: '直接跳转 URL',
        serviceName: 'jump', profileName: 'direct', transport: 'browser redirect',
        evidenceLevel: 'official-static-derived'
    })
});

export function getOfficialInstanceFamily(method) {
    const selected = OFFICIAL_INSTANCE_CATALOG[method];
    return selected ? Object.freeze({ defaultVariant: selected.id, variants: Object.freeze([selected]) }) : null;
}

export function getDefaultOfficialInstanceVariant(method) {
    return OFFICIAL_INSTANCE_CATALOG[method]?.id || null;
}

export function resolveOfficialInstance(config = {}) {
    const method = String(config.method || '');
    const selected = OFFICIAL_INSTANCE_CATALOG[method];
    if (!selected) {
        throw new OfficialJumpNotImplementedError(`尚未登记官方系统类型: ${method}`, {
            code: 'OFFICIAL_INSTANCE_METHOD_NOT_REGISTERED',
            details: { method }
        });
    }
    return selected;
}

