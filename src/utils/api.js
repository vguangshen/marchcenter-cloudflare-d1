import { API_BASE } from '../constants/config';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const UNAUTHORIZED_EVENT = 'marchcenter:unauthorized';

const resolveUrl = (input) => {
    const value = String(input);
    if (/^https?:\/\//i.test(value) || value.startsWith(`${API_BASE}/`) || value === API_BASE) {
        return value;
    }
    return `${API_BASE}${value.startsWith('/') ? value : `/${value}`}`;
};

const isApiUrl = (url) => {
    if (url.startsWith(`${API_BASE}/`) || url === API_BASE) return true;
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.origin === window.location.origin
            && (parsed.pathname === API_BASE || parsed.pathname.startsWith(`${API_BASE}/`));
    } catch {
        return false;
    }
};

const createRequestSignal = (externalSignal, timeoutMs) => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal) {
        if (externalSignal.aborted) abortFromExternal();
        else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
    const timer = Number(timeoutMs) > 0
        ? window.setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('请求超时', 'TimeoutError'));
        }, Number(timeoutMs))
        : null;
    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        dispose: () => {
            if (timer) window.clearTimeout(timer);
            externalSignal?.removeEventListener?.('abort', abortFromExternal);
        }
    };
};

const wait = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
        return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
        window.clearTimeout(timer);
        reject(signal.reason || new DOMException('请求已取消', 'AbortError'));
    }, { once: true });
});

const isRetryableMethod = method => ['GET', 'HEAD', 'OPTIONS'].includes(method);
const isRetryableStatus = status => [408, 425, 429, 500, 502, 503, 504].includes(status);

export class ApiError extends Error {
    constructor(message, { status = 0, code = '', requestId = '', cause } = {}) {
        super(message, { cause });
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.requestId = requestId;
    }
}

export const apiFetch = async (input, options = {}) => {
    const url = resolveUrl(input);
    const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retry = isRetryableMethod(String(options.method || 'GET').toUpperCase()) ? DEFAULT_RETRY_COUNT : 0,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        headers: customHeaders,
        signal: externalSignal,
        ...requestOptions
    } = options;
    const headers = new Headers(customHeaders || {});
    const token = localStorage.getItem('authToken');
    if (token && isApiUrl(url) && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (
        requestOptions.body != null
        && !(requestOptions.body instanceof FormData)
        && !headers.has('Content-Type')
    ) {
        headers.set('Content-Type', 'application/json');
    }

    const requestSignal = createRequestSignal(externalSignal, timeoutMs);
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const retryCount = Math.max(0, Math.min(3, Number(retry) || 0));
    try {
        for (let attempt = 0; attempt <= retryCount; attempt += 1) {
            let response;
            try {
                response = await fetch(url, {
                    ...requestOptions,
                    headers,
                    signal: requestSignal.signal
                });
            } catch (error) {
                if (attempt < retryCount && isRetryableMethod(method) && !requestSignal.signal.aborted) {
                    await wait(Number(retryDelayMs) * (attempt + 1), requestSignal.signal);
                    continue;
                }
                throw error;
            }
            if (response.status === 401 && isApiUrl(url) && (token || headers.has('Authorization'))) {
                window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, {
                    detail: { url, status: response.status }
                }));
            }
            if (attempt < retryCount && isRetryableMethod(method) && isRetryableStatus(response.status)) {
                await response.body?.cancel();
                await wait(Number(retryDelayMs) * (attempt + 1), requestSignal.signal);
                continue;
            }
            return response;
        }
    } catch (error) {
        if (requestSignal.didTimeout()) {
            throw new ApiError('请求超时，请检查网络后重试', {
                code: 'request_timeout',
                cause: error
            });
        }
        if (error?.name === 'AbortError') throw error;
        if (error instanceof ApiError) throw error;
        throw new ApiError('网络连接失败，请检查网络后重试', {
            code: 'network_error',
            cause: error
        });
    } finally {
        requestSignal.dispose();
    }
};

export const parseApiResponse = async (response, fallback = '请求失败') => {
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new ApiError(data.error || data.message || fallback, {
            status: response.status,
            code: data.code || '',
            requestId: data.requestId || ''
        });
    }
    return data;
};

export const apiRequest = async (input, options = {}) => {
    const { fallback, ...requestOptions } = options;
    return parseApiResponse(await apiFetch(input, requestOptions), fallback);
};

export const apiBlob = async (input, options = {}) => {
    const { fallback, ...requestOptions } = options;
    const response = await apiFetch(input, requestOptions);
    if (!response.ok) await parseApiResponse(response, fallback || '请求失败');
    return {
        blob: await response.blob(),
        headers: response.headers
    };
};

/**
 * Read a server-sent event response while keeping transport concerns in the
 * same client as ordinary JSON requests. The callback receives parsed data
 * when possible and the raw event name for non-JSON payloads.
 */
export const apiStream = async (input, options = {}, onEvent = () => {}) => {
    const {
        timeoutMs = 90_000,
        fallback = '请求失败',
        ...requestOptions
    } = options;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = Number(timeoutMs) > 0
        ? window.setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('请求超时', 'TimeoutError'));
        }, Number(timeoutMs))
        : null;
    try {
        const response = await apiFetch(input, {
            ...requestOptions,
            retry: 0,
            timeoutMs: 0,
            signal: controller.signal
        });
        if (!response.ok) return parseApiResponse(response, fallback);
        if (!response.body) throw new ApiError('服务器未返回阶段流', { code: 'empty_stream' });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData;
        const emit = block => {
            const lines = block.split(/\r?\n/);
            let event = 'message';
            const dataLines = [];
            for (const line of lines) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
            }
            if (!dataLines.length) return;
            const raw = dataLines.join('\n');
            let data = raw;
            try { data = JSON.parse(raw); } catch { /* keep text */ }
            const message = { event, data };
            onEvent(message);
            if (event === 'result') finalData = data?.data ?? data;
            if (event === 'error') throw new ApiError(data?.error || '服务端执行失败', {
                status: Number(data?.status) || 500,
                code: data?.code || 'stream_error'
            });
        };

        while (true) {
            const { value, done } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                emit(block);
            }
            if (done) break;
        }
        if (buffer.trim()) emit(buffer);
        if (finalData === undefined) throw new ApiError('服务器未返回执行结果', { code: 'missing_stream_result' });
        return finalData;
    } catch (error) {
        if (timedOut) throw new ApiError('请求超时，请检查网络后重试', { code: 'request_timeout', cause: error });
        throw error;
    } finally {
        if (timeout) window.clearTimeout(timeout);
        controller.abort();
    }
};

export const onUnauthorized = (listener) => {
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener);
};

export const api = {
    get: (url, options = {}) => apiRequest(url, { ...options, method: 'GET' }),
    post: (url, body, options = {}) => apiRequest(url, {
        ...options,
        method: 'POST',
        body: body instanceof FormData ? body : JSON.stringify(body)
    }),
    put: (url, body, options = {}) => apiRequest(url, {
        ...options,
        method: 'PUT',
        body: body instanceof FormData ? body : JSON.stringify(body)
    }),
    patch: (url, body, options = {}) => apiRequest(url, {
        ...options,
        method: 'PATCH',
        body: body instanceof FormData ? body : JSON.stringify(body)
    }),
    delete: (url, options = {}) => apiRequest(url, { ...options, method: 'DELETE' }),
    blob: apiBlob,
    stream: apiStream
};
