import { getEnv } from "../config/runtime.js";

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const HEADER_ALLOWANCE_BYTES = 64 * 1024;

function normalizedHostname(hostname) {
    return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function parseIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
    const octets = hostname.split('.').map(Number);
    return octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ? octets : null;
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requestLimits(options = {}) {
    return {
        timeoutMs: positiveInteger(
            options.timeoutMs ?? getEnv('SSO_OUTBOUND_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
            DEFAULT_TIMEOUT_MS
        ),
        maxResponseBytes: positiveInteger(
            options.maxResponseBytes ?? getEnv('SSO_MAX_RESPONSE_BYTES', DEFAULT_MAX_RESPONSE_BYTES),
            DEFAULT_MAX_RESPONSE_BYTES
        )
    };
}

export function assertSafeOutboundUrl(value) {
    let url;
    try { url = value instanceof URL ? new URL(value) : new URL(value); }
    catch { throw new Error('远程平台地址格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('远程平台仅支持 HTTP 或 HTTPS');
    if (url.username || url.password) throw new Error('远程平台地址不能包含账号或密码');

    return url;
}

export function isRawIpHttpUrl(value) {
    try {
        const url = new URL(value);
        const hostname = normalizedHostname(url.hostname);
        return url.protocol === 'http:' && (Boolean(parseIpv4(hostname)) || hostname.includes(':'));
    } catch {
        return false;
    }
}

function findSequence(bytes, sequence, start = 0) {
    outer: for (let index = start; index <= bytes.length - sequence.length; index += 1) {
        for (let offset = 0; offset < sequence.length; offset += 1) {
            if (bytes[index + offset] !== sequence[offset]) continue outer;
        }
        return index;
    }
    return -1;
}

function concatBytes(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function parseHeaderBlock(bytes) {
    const headerEnd = findSequence(bytes, new Uint8Array([13, 10, 13, 10]));
    if (headerEnd < 0) return null;
    const lines = new TextDecoder().decode(bytes.subarray(0, headerEnd)).split('\r\n');
    const statusMatch = lines.shift()?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/i);
    if (!statusMatch) throw new Error('HTTP response status line is invalid');
    const headers = {};
    for (const line of lines) {
        const separator = line.indexOf(':');
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim().toLowerCase();
        const content = line.slice(separator + 1).trim();
        headers[name] = headers[name] ? `${headers[name]}, ${content}` : content;
    }
    return { headerEnd, statusMatch, headers };
}

function chunkedMessageEnd(bytes, bodyStart) {
    const crlf = new Uint8Array([13, 10]);
    let cursor = bodyStart;
    while (cursor < bytes.length) {
        const lineEnd = findSequence(bytes, crlf, cursor);
        if (lineEnd < 0) return null;
        const sizeLine = new TextDecoder().decode(bytes.subarray(cursor, lineEnd));
        const size = Number.parseInt(sizeLine.split(';', 1)[0].trim(), 16);
        if (!Number.isFinite(size)) throw new Error('HTTP chunk size is invalid');
        cursor = lineEnd + 2;
        if (size === 0) {
            if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) return cursor + 2;
            const trailersEnd = findSequence(bytes, new Uint8Array([13, 10, 13, 10]), cursor);
            return trailersEnd < 0 ? null : trailersEnd + 4;
        }
        if (cursor + size + 2 > bytes.length) return null;
        cursor += size;
        if (bytes[cursor] !== 13 || bytes[cursor + 1] !== 10) throw new Error('HTTP chunk terminator is invalid');
        cursor += 2;
    }
    return null;
}

function completeMessageEnd(bytes, maxResponseBytes) {
    const parsed = parseHeaderBlock(bytes);
    if (!parsed) return null;
    const bodyStart = parsed.headerEnd + 4;
    const contentLength = parsed.headers['content-length'];
    if (/^\d+$/.test(contentLength || '')) {
        const length = Number(contentLength);
        if (length > maxResponseBytes) throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);
        return bytes.length >= bodyStart + length ? bodyStart + length : null;
    }
    if (/\bchunked\b/i.test(parsed.headers['transfer-encoding'] || '')) {
        return chunkedMessageEnd(bytes, bodyStart);
    }
    return null;
}

function decodeChunkedBody(bytes) {
    const crlf = new Uint8Array([13, 10]);
    const chunks = [];
    let cursor = 0;
    while (cursor < bytes.length) {
        const lineEnd = findSequence(bytes, crlf, cursor);
        if (lineEnd < 0) throw new Error('HTTP chunk size is incomplete');
        const sizeLine = new TextDecoder().decode(bytes.subarray(cursor, lineEnd));
        const size = Number.parseInt(sizeLine.split(';', 1)[0].trim(), 16);
        if (!Number.isFinite(size)) throw new Error('HTTP chunk size is invalid');
        cursor = lineEnd + 2;
        if (size === 0) break;
        if (cursor + size > bytes.length) throw new Error('HTTP chunk body is incomplete');
        chunks.push(bytes.slice(cursor, cursor + size));
        cursor += size;
        if (bytes[cursor] !== 13 || bytes[cursor + 1] !== 10) throw new Error('HTTP chunk terminator is invalid');
        cursor += 2;
    }
    return concatBytes(chunks);
}

export function parseRawHttpResponse(input, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const parsed = parseHeaderBlock(bytes);
    if (!parsed) throw new Error('HTTP response headers are incomplete');
    let bodyBytes = bytes.subarray(parsed.headerEnd + 4);
    if (/\bchunked\b/i.test(parsed.headers['transfer-encoding'] || '')) {
        bodyBytes = decodeChunkedBody(bodyBytes);
    } else if (/^\d+$/.test(parsed.headers['content-length'] || '')) {
        const expected = Number(parsed.headers['content-length']);
        if (expected > maxResponseBytes) throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);
        if (bodyBytes.length < expected) throw new Error(`远程平台响应不完整：应收到 ${expected} 字节，实际收到 ${bodyBytes.length} 字节`);
        bodyBytes = bodyBytes.subarray(0, expected);
    }
    if (bodyBytes.length > maxResponseBytes) throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);

    const status = Number(parsed.statusMatch[1]);
    return {
        status,
        statusText: parsed.statusMatch[2] || '',
        headers: parsed.headers,
        data: new TextDecoder().decode(bodyBytes),
        ok: status >= 200 && status < 300
    };
}

async function withDeadline(promise, deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('远程平台请求超时');
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('远程平台请求超时')), remaining); })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function readFetchBody(response, maxResponseBytes) {
    const declaredLength = Number(response.headers.get('Content-Length') || 0);
    if (declaredLength > maxResponseBytes) throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > maxResponseBytes) {
                await reader.cancel();
                throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return new TextDecoder().decode(concatBytes(chunks));
}

export async function rawHttpText(value, options = {}) {
    const url = assertSafeOutboundUrl(value, options);
    if (!isRawIpHttpUrl(url.toString())) throw new Error('Raw TCP transport only supports HTTP IP addresses');
    const { timeoutMs, maxResponseBytes } = requestLimits(options);
    const { connect } = await import('cloudflare:sockets');
    const hostname = normalizedHostname(url.hostname);
    const port = Number(url.port || 80);
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body === undefined || options.body === null ? '' : String(options.body);
    const bodyBytes = new TextEncoder().encode(body);
    const headers = {
        Host: url.host,
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        ...(options.headers || {})
    };
    if (bodyBytes.length > 0 && !Object.keys(headers).some(name => name.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(bodyBytes.length);
    }

    const path = `${url.pathname || '/'}${url.search}`;
    const head = `${method} ${path} HTTP/1.1\r\n${Object.entries(headers)
        .map(([name, content]) => `${name}: ${content}`).join('\r\n')}\r\n\r\n`;
    const requestBytes = concatBytes([new TextEncoder().encode(head), bodyBytes]);
    const socket = connect({ hostname, port }, { allowHalfOpen: true });
    const chunks = [];
    let received = 0;
    let reader;
    let writer;
    const deadline = Date.now() + timeoutMs;

    try {
        await withDeadline(socket.opened, deadline);
        writer = socket.writable.getWriter();
        await withDeadline(writer.write(requestBytes), deadline);
        writer.releaseLock();
        writer = null;

        reader = socket.readable.getReader();
        while (true) {
            const { value: chunk, done } = await withDeadline(reader.read(), deadline);
            if (done) break;
            if (chunk?.length) {
                chunks.push(chunk);
                received += chunk.length;
                if (received > maxResponseBytes + HEADER_ALLOWANCE_BYTES) {
                    throw new Error(`远程平台响应超过 ${maxResponseBytes} 字节限制`);
                }
                const bytes = concatBytes(chunks);
                const messageEnd = completeMessageEnd(bytes, maxResponseBytes);
                if (messageEnd !== null) {
                    const response = parseRawHttpResponse(bytes.subarray(0, messageEnd), maxResponseBytes);
                    reader.releaseLock();
                    reader = null;
                    return response;
                }
            }
        }
        reader.releaseLock();
        reader = null;
        return parseRawHttpResponse(concatBytes(chunks), maxResponseBytes);
    } finally {
        try { writer?.releaseLock(); } catch { /* writer may already be released */ }
        try { reader?.releaseLock(); } catch { /* reader may already be released */ }
        try { await socket.close(); } catch { /* socket may already be closed by the peer */ }
    }
}

export async function safeHttpText(value, options = {}) {
    const url = assertSafeOutboundUrl(value, options);
    if (isRawIpHttpUrl(url.toString())) return rawHttpText(url.toString(), options);
    const { timeoutMs, maxResponseBytes } = requestLimits(options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('远程平台请求超时')), timeoutMs);
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body,
            // Cloudflare Workers only supports "follow" and "manual" here.
            // Keep redirects visible to callers so they can validate the status
            // instead of following an untrusted location automatically.
            redirect: 'manual',
            signal: controller.signal
        });
        const data = await readFetchBody(response, maxResponseBytes);
        return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data,
            ok: response.ok
        };
    } catch (error) {
        if (controller.signal.aborted) throw new Error('远程平台请求超时');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
