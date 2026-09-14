import { OfficialJumpConfigError } from './errors.js';
import { isRawIpHttpUrl, rawHttpText } from '../safeHttpClient.js';

function effectivePort(url) {
    return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function withinContext(pathname, contextPath) {
    if (contextPath === '/') return pathname.startsWith('/');
    return pathname === contextPath || pathname.startsWith(`${contextPath}/`);
}

function isLoopbackLiteral(hostname) {
    const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === '::1' || normalized.startsWith('127.');
}

function assertExactTarget(base, value) {
    const target = value instanceof Request ? new URL(value.url) : new URL(value);
    if (target.protocol !== base.protocol
        || target.hostname.toLowerCase() !== base.hostname.toLowerCase()
        || effectivePort(target) !== effectivePort(base)
        || !withinContext(target.pathname, base.pathname)) {
        throw new OfficialJumpConfigError('official transport 请求越出卡片配置的精确目标边界', {
            code: 'OFFICIAL_TRANSPORT_TARGET_REJECTED'
        });
    }
    return target;
}

/**
 * Fetch-compatible transport for the default production composition. An
 * explicitly injected fetch (notably canary targetPolicy) remains authoritative
 * and is never bypassed by this module. Response limits and deadlines are also
 * enforced by the JAVA/SOAP clients consuming this response.
 */
export function createOfficialSafeFetch(options = {}) {
    const baseUrl = options.baseUrl;
    const fetchImplementation = options.fetchImplementation || globalThis.fetch;
    const rawHttpImplementation = options.rawHttpImplementation || rawHttpText;
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
        throw new TypeError('official safe transport baseUrl 必填');
    }
    if (typeof fetchImplementation !== 'function') throw new TypeError('official safe transport fetch 必须是函数');
    const base = new URL(baseUrl);
    // Cloudflare fetch cannot reliably reach the vendor's HTTP services on
    // arbitrary high ports. Keep the normal injected fetch authoritative for
    // tests/canary, but use the existing bounded TCP HTTP client for the
    // production composition when the card root is an explicit IP literal.
    const useRawIpTransport = options.fetchImplementation === undefined
        && isRawIpHttpUrl(base.toString())
        // Miniflare and local canary platforms are deliberately supplied as
        // loopback services. Keep them on workerd fetch so their explicit
        // service boundary remains intact; raw TCP is only needed for the
        // vendor-style non-loopback HTTP/IP targets used in production.
        && !isLoopbackLiteral(base.hostname);
    if (base.protocol === 'http:' && options.allowHttp !== true) {
        throw new OfficialJumpConfigError('HTTP 平台必须显式启用明文传输风险配置', {
            code: 'OFFICIAL_HTTP_NOT_ALLOWED'
        });
    }

    return async function officialSafeFetch(input, init = {}) {
        const target = assertExactTarget(base, input);
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
        if (headers.has('host')) {
            throw new OfficialJumpConfigError('official transport 禁止覆盖 Host Header', {
                code: 'OFFICIAL_TRANSPORT_HOST_REJECTED'
            });
        }
        if (init.cf && Object.prototype.hasOwnProperty.call(init.cf, 'resolveOverride')) {
            throw new OfficialJumpConfigError('official transport 禁止改写解析目标', {
                code: 'OFFICIAL_TRANSPORT_TARGET_REJECTED'
            });
        }
        if (useRawIpTransport) {
            const requestBody = init.body === undefined || init.body === null
                ? ''
                : String(init.body);
            const rawResponse = await rawHttpImplementation(target.toString(), {
                method: init.method || (input instanceof Request ? input.method : 'GET'),
                headers: Object.fromEntries(headers.entries()),
                body: requestBody,
                timeoutMs: options.timeoutMs,
                maxResponseBytes: options.maxResponseBytes
            });
            if (rawResponse.status >= 300 && rawResponse.status < 400
                && options.allowRedirectResponse !== true) {
                throw new OfficialJumpConfigError('official transport 禁止 HTTP 重定向', {
                    code: 'OFFICIAL_TRANSPORT_REDIRECT_REJECTED'
                });
            }
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(rawResponse.headers || {})) {
                if (!['connection', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
                    responseHeaders.set(name, value);
                }
            }
            const bodyAllowed = ![101, 204, 205, 304].includes(rawResponse.status);
            return new Response(bodyAllowed ? rawResponse.data : null, {
                status: rawResponse.status,
                statusText: rawResponse.statusText,
                headers: responseHeaders
            });
        }
        const response = await fetchImplementation(target.toString(), {
            ...init,
            headers,
            redirect: 'manual'
        });
        if (response.status >= 300 && response.status < 400
            && options.allowRedirectResponse !== true) {
            throw new OfficialJumpConfigError('official transport 禁止 HTTP 重定向', {
                code: 'OFFICIAL_TRANSPORT_REDIRECT_REJECTED'
            });
        }
        return response;
    };
}
