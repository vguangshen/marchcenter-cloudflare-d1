import { OfficialCanaryTargetError } from './errors.js';

function normalizeHost(value) {
    return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function parseIpv4(value) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
    const parts = value.split('.').map(Number);
    return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function isIpv6(value) {
    return value.includes(':') && /^[0-9a-f:]+$/i.test(value);
}

export function isIpAddress(value) {
    const normalized = normalizeHost(value);
    return Boolean(parseIpv4(normalized) || isIpv6(normalized));
}

function isMetadataAddress(value) {
    const host = normalizeHost(value);
    return [
        '169.254.169.254', '169.254.170.2', '169.254.169.123',
        '100.100.100.200', '168.63.129.16', 'fd00:ec2::254'
    ].includes(host);
}

function isPrivateAddress(value) {
    const host = normalizeHost(value);
    const ipv4 = parseIpv4(host);
    if (ipv4) {
        return ipv4[0] === 10
            || ipv4[0] === 127
            || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
            || (ipv4[0] === 192 && ipv4[1] === 168)
            || (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
            || (ipv4[0] === 169 && ipv4[1] === 254);
    }
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

function effectivePort(url) {
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

function pathWithinContext(pathname, contextPath) {
    if (contextPath === '/') return pathname.startsWith('/');
    return pathname === contextPath || pathname.startsWith(`${contextPath}/`);
}

function safeTarget(url) {
    return { protocol: url.protocol, hostname: normalizeHost(url.hostname), port: effectivePort(url), path: url.pathname };
}

export function validateApprovedAddresses(specification) {
    const addresses = specification.approvedResolvedAddresses.map(normalizeHost);
    if (addresses.some(address => !isIpAddress(address))) {
        throw new OfficialCanaryTargetError('approvedResolvedAddresses 只能包含精确 IP');
    }
    if (addresses.some(isMetadataAddress)) {
        throw new OfficialCanaryTargetError('metadata 地址永远不能加入 canary 白名单');
    }
    if (addresses.some(isPrivateAddress) && specification.privateTargetExplicitlyApproved !== true) {
        throw new OfficialCanaryTargetError('私网或回环地址必须单独明确批准');
    }
    if (isIpAddress(specification.allowedHostname)
        && !addresses.includes(normalizeHost(specification.allowedHostname))) {
        throw new OfficialCanaryTargetError('IP 形式 hostname 必须同时出现在 approvedResolvedAddresses');
    }
    return Object.freeze([...new Set(addresses)]);
}

export function createCanaryTargetPolicy(specification, options = {}) {
    const resolveHostname = options.resolveHostname;
    if (typeof resolveHostname !== 'function') {
        throw new TypeError('canary resolveHostname 必须显式注入');
    }
    const approvedAddresses = validateApprovedAddresses(specification);
    const approvedBaseUrl = new URL(specification.officialBaseUrl);
    const approvedHostname = normalizeHost(specification.allowedHostname);
    const approvedContextPath = specification.allowedContextPath || approvedBaseUrl.pathname;
    let expectedResolution = null;
    let resolutionCheckCount = 0;

    async function assertRequest(value) {
        let url;
        try { url = value instanceof Request ? new URL(value.url) : new URL(value); }
        catch { throw new OfficialCanaryTargetError('canary 请求 URL 无效'); }
        const target = safeTarget(url);
        if (target.protocol !== approvedBaseUrl.protocol
            || target.hostname !== approvedHostname
            || target.port !== specification.allowedPort
            || !pathWithinContext(target.path, approvedContextPath)) {
            throw new OfficialCanaryTargetError('canary 请求越出精确 protocol/host/port/path 白名单', {
                details: { target }
            });
        }
        const resolved = [...new Set((await resolveHostname(target.hostname)).map(normalizeHost))].sort();
        resolutionCheckCount += 1;
        if (resolved.length === 0 || resolved.some(address => !approvedAddresses.includes(address))) {
            throw new OfficialCanaryTargetError('DNS 解析结果包含未批准地址', {
                code: 'OFFICIAL_CANARY_DNS_REJECTED', details: { target, resolvedCount: resolved.length }
            });
        }
        if (resolved.some(isMetadataAddress)) {
            throw new OfficialCanaryTargetError('DNS 解析命中 metadata 地址');
        }
        if (resolved.some(isPrivateAddress) && specification.privateTargetExplicitlyApproved !== true) {
            throw new OfficialCanaryTargetError('DNS 解析命中未明确批准的私网或回环地址');
        }
        if (expectedResolution === null) {
            expectedResolution = Object.freeze(resolved.slice());
        } else if (expectedResolution.length !== resolved.length
            || expectedResolution.some((address, index) => address !== resolved[index])) {
            throw new OfficialCanaryTargetError('canary 期间 DNS 结果发生变化，已停止请求', {
                code: 'OFFICIAL_CANARY_DNS_CHANGED',
                details: { target, previousCount: expectedResolution.length, resolvedCount: resolved.length }
            });
        }
        return Object.freeze({ url, target, resolved: Object.freeze(resolved) });
    }

    return Object.freeze({
        assertRequest,
        assertBaseTarget: () => assertRequest(specification.officialBaseUrl),
        approvedAddresses,
        getResolutionCheckCount: () => resolutionCheckCount
    });
}

export function createCanaryFetch(options = {}) {
    const fetchImplementation = options.fetchImplementation;
    const policy = options.policy;
    if (typeof fetchImplementation !== 'function') throw new TypeError('canary fetchImplementation 必须显式注入');
    if (!policy || typeof policy.assertRequest !== 'function') throw new TypeError('canary target policy 必须显式注入');
    const onRequest = typeof options.onRequest === 'function' ? options.onRequest : async () => {};

    return async function canaryFetch(input, init = {}) {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
        if (headers.has('host')) {
            throw new OfficialCanaryTargetError('canary 禁止手工设置 Host Header');
        }
        if (init.cf && Object.prototype.hasOwnProperty.call(init.cf, 'resolveOverride')) {
            throw new OfficialCanaryTargetError('canary 禁止使用 resolveOverride 改写连接目标');
        }
        const checked = await policy.assertRequest(input);
        await onRequest({ method: String(init.method || 'GET').toUpperCase(), target: checked.target });
        const response = await fetchImplementation(input, { ...init, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
            throw new OfficialCanaryTargetError('canary 禁止跟随 HTTP 重定向', {
                code: 'OFFICIAL_CANARY_REDIRECT_REJECTED',
                details: { status: response.status, target: checked.target }
            });
        }
        return response;
    };
}
