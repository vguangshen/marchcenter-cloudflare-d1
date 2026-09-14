export const SSO_METHOD_OPTIONS = [
    { id: 'java', name: 'JAVA 通用', detail: 'REST Token / Ticket' },
    { id: 'net', name: '.NET 通用', detail: '标准 SOAP 登录' },
    { id: 'marketing', name: '市场营销沙盘', detail: '营销沙盘专用' },
    { id: 'commerce', name: '电子商务沙盘', detail: '网店运营沙盘专用' },
    { id: 'managementAccounting', name: '管理会计高级', detail: '管理会计高级沙盘' },
    { id: 'crossBorderCommerce', name: '跨境电商', detail: '跨境电商沙盘' },
    { id: 'enterpriseManagement', name: '企业管理', detail: '企业管理沙盘' },
    { id: 'direct', name: '直接跳转', detail: '不生成登录票据' }
];

export const SOAP_SSO_METHODS = new Set(['net', 'marketing', 'commerce', 'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement']);
export const ACCOUNT_SSO_METHODS = new Set(['java', ...SOAP_SSO_METHODS]);
export const CLASS_TYPE_METHODS = new Set(['java', ...SOAP_SSO_METHODS]);
export const defaultClassType = method => (
    ['marketing', 'commerce', 'managementAccounting', 'enterpriseManagement'].includes(method) ? '3' : '1'
);

export const parseSsoConfig = item => {
    try { return typeof item?.configData === 'string' ? JSON.parse(item.configData) : (item?.configData || {}); }
    catch { return {}; }
};

export const PASSWORD_ALGORITHM_OPTIONS = [
    { id: 'itmc-java-long-md5', name: 'JAVA Long MD5', detail: 'JAVA 通用平台' },
    { id: 'itmc-des', name: '.NET 通用 DES', detail: '普通 .NET 系统' },
    { id: 'itmc-sandbox-des', name: '沙盘专用 DES', detail: '新版营销、商贸、会计及企业沙盘' },
    { id: 'plain', name: '明文', detail: '仅用于明确以明文保存密码的旧系统' },
    { id: 'md5-lower', name: 'MD5 小写', detail: '32 位小写 MD5' },
    { id: 'md5-upper', name: 'MD5 大写', detail: '32 位大写 MD5' },
    { id: 'double-md5-lower', name: '双重 MD5 小写', detail: '对小写 MD5 再做一次 MD5' },
    { id: 'sha1-lower', name: 'SHA-1 小写', detail: '40 位小写 SHA-1' },
    { id: 'sha1-upper', name: 'SHA-1 大写', detail: '40 位大写 SHA-1' },
    { id: 'sha256-lower', name: 'SHA-256 小写', detail: '64 位小写 SHA-256' },
    { id: 'sha256-upper', name: 'SHA-256 大写', detail: '64 位大写 SHA-256' }
];

export const describeLinkTransport = (value, ssoMethod) => {
    if (!value?.trim()) return { label: '等待填写链接', detail: '填写后自动判断请求方式', tone: 'slate' };
    if (!ssoMethod || ssoMethod === 'direct') return { label: '浏览器直接跳转', detail: '不会由 Cloudflare Worker 请求目标地址', tone: 'emerald' };
    try {
        const url = new URL(value.trim());
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const isIpAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
        if (url.protocol === 'http:' && isIpAddress) {
            return { label: '受限服务端 Fetch', detail: '明文凭据有传输风险；请求仅允许当前卡片的 hostname、port 与项目路径，并限制超时、响应大小和重定向', tone: 'amber' };
        }
        return { label: '标准 Fetch', detail: '由 Cloudflare Worker 使用标准 HTTP 客户端请求', tone: 'blue' };
    } catch {
        return { label: '链接格式待确认', detail: '请输入完整的 http:// 或 https:// 地址', tone: 'red' };
    }
};
