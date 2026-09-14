/**
 * A deliberately small Express-compatible router for Cloudflare Workers.
 * It supports the subset used by MarchCenter: Router(), use(), HTTP methods,
 * route params, async middleware, res.status/json/send/setHeader and JSON bodies.
 */

function normalizePath(path) {
    if (!path) return '/';
    const normalized = `/${String(path).replace(/^\/+|\/+$/g, '')}`;
    return normalized === '//' ? '/' : normalized;
}

function joinPaths(prefix, path) {
    const left = normalizePath(prefix);
    const right = normalizePath(path);
    if (left === '/') return right;
    if (right === '/') return left;
    return `${left}${right}`;
}

function compilePath(path) {
    const names = [];
    const escaped = normalizePath(path)
        .split('/')
        .map(part => {
            if (!part) return '';
            if (part === '*') {
                names.push('wildcard');
                return '(.*)';
            }
            if (part.startsWith(':')) {
                names.push(part.slice(1));
                return '([^/]+)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    return { regex: new RegExp(`^${escaped}/?$`), names };
}

function responseFacade(requestId) {
    let statusCode = 200;
    const headers = new Headers();
    let payload = null;
    let sent = false;

    const api = {
        get headersSent() { return sent; },
        status(code) {
            statusCode = Number(code) || 500;
            return api;
        },
        setHeader(name, value) {
            headers.set(name, String(value));
            return api;
        },
        json(value) {
            if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
            let responseValue = value ?? null;
            if (statusCode === 500) {
                console.error('[Worker internal response]', {
                    requestId,
                    error: value?.error || value?.message || 'Unknown internal error'
                });
                responseValue = {
                    error: '服务器内部错误',
                    code: 'internal_error',
                    requestId
                };
            }
            payload = JSON.stringify(responseValue);
            sent = true;
            return api;
        },
        send(value) {
            if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
                payload = value;
            } else if (typeof value === 'object' && value !== null) {
                return api.json(value);
            } else {
                payload = value == null ? '' : String(value);
                if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/plain; charset=utf-8');
            }
            sent = true;
            return api;
        },
        stream(value, extraHeaders = {}) {
            for (const [name, headerValue] of Object.entries(extraHeaders)) headers.set(name, String(headerValue));
            payload = value;
            sent = true;
            return api;
        },
        _toResponse() {
            if (!sent) return null;
            return new Response(payload, { status: statusCode, headers });
        }
    };
    return api;
}

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

function bodyTooLargeError(limitBytes) {
    const error = new Error(`请求内容不能超过 ${Math.max(1, Math.floor(limitBytes / (1024 * 1024)))}MB`);
    error.status = 413;
    return error;
}

async function readTextBody(request, limitBytes) {
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > limitBytes) throw bodyTooLargeError(limitBytes);
    if (!request.body) return '';

    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let text = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limitBytes) {
                await reader.cancel();
                throw bodyTooLargeError(limitBytes);
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        return text;
    } finally {
        reader.releaseLock();
    }
}

async function readBody(request, limitBytes = DEFAULT_BODY_LIMIT_BYTES) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return {};
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        const text = await readTextBody(request, limitBytes);
        if (!text) return {};
        try { return JSON.parse(text); }
        catch {
            const error = new Error('请求 JSON 格式无效');
            error.status = 400;
            throw error;
        }
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(await readTextBody(request, limitBytes)));
    }
    return {};
}

function createRouter() {
    const stack = [];

    const api = {
        _stack: stack,
        use(pathOrHandler, ...rest) {
            let prefix = '/';
            let handlers = [pathOrHandler, ...rest];
            if (typeof pathOrHandler === 'string') {
                prefix = pathOrHandler;
                handlers = rest;
            }
            for (const handler of handlers.flat()) {
                if (!handler) continue;
                if (handler._stack) {
                    for (const route of handler._stack) {
                        stack.push({ ...route, path: joinPaths(prefix, route.path), compiled: null });
                    }
                } else if (typeof handler === 'function') {
                    stack.push({ method: null, path: normalizePath(prefix), middlewarePrefix: true, handlers: [handler], compiled: null });
                }
            }
            return api;
        },
        _add(method, path, handlers) {
            stack.push({ method, path: normalizePath(path), handlers: handlers.flat(), compiled: null });
            return api;
        },
        get(path, ...handlers) { return api._add('GET', path, handlers); },
        post(path, ...handlers) { return api._add('POST', path, handlers); },
        put(path, ...handlers) { return api._add('PUT', path, handlers); },
        patch(path, ...handlers) { return api._add('PATCH', path, handlers); },
        delete(path, ...handlers) { return api._add('DELETE', path, handlers); },
        options(path, ...handlers) { return api._add('OPTIONS', path, handlers); },
        async handle(request, { bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES } = {}) {
            const url = new URL(request.url);
            const requestPath = normalizePath(url.pathname);
            const requestId = crypto.randomUUID();
            const reqHeaders = Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
            let body;
            try {
                body = await readBody(request, bodyLimitBytes);
            } catch (error) {
                const status = Number(error?.status) || 400;
                return Response.json(
                    status >= 500
                        ? { error: '服务器内部错误', code: 'internal_error', requestId }
                        : { error: error?.message || '请求格式无效' },
                    { status }
                );
            }
            const req = {
                method: request.method.toUpperCase(),
                url: request.url,
                path: requestPath,
                query: Object.fromEntries(url.searchParams),
                headers: reqHeaders,
                ip: reqHeaders['cf-connecting-ip'] || reqHeaders['x-forwarded-for']?.split(',')[0]?.trim() || '',
                params: {},
                body,
                raw: request,
                user: null
            };

            const globalMiddleware = [];
            let matched = null;
            let params = {};

            for (const route of stack) {
                if (route.middlewarePrefix) {
                    const prefix = route.path === '/' ? '/' : `${route.path}/`;
                    if (requestPath === route.path || requestPath.startsWith(prefix)) globalMiddleware.push(...route.handlers);
                    continue;
                }
                if (route.method !== req.method && !(req.method === 'HEAD' && route.method === 'GET')) continue;
                route.compiled ||= compilePath(route.path);
                const match = route.compiled.regex.exec(requestPath);
                if (!match) continue;
                matched = route;
                try {
                    params = Object.fromEntries(route.compiled.names.map((name, index) => [
                        name,
                        decodeURIComponent(match[index + 1] || '')
                    ]));
                } catch {
                    return Response.json({ error: '路径参数编码无效' }, { status: 400 });
                }
                break;
            }

            if (!matched) return null;
            req.params = params;
            const res = responseFacade(requestId);
            const handlers = [...globalMiddleware, ...matched.handlers];

            const dispatch = async index => {
                if (index >= handlers.length || res.headersSent) return;
                const handler = handlers[index];
                let nextPromise = null;
                let nextCalled = false;
                const next = () => {
                    if (nextCalled) return nextPromise;
                    nextCalled = true;
                    nextPromise = dispatch(index + 1);
                    return nextPromise;
                };
                const returned = await handler(req, res, next);
                if (nextPromise) await nextPromise;
                return returned;
            };

            try {
                await dispatch(0);
            } catch (error) {
                console.error('[Worker router]', { requestId, error });
                if (!res.headersSent) {
                    const status = Number(error.status) || 500;
                    res.status(status).json({
                        error: status >= 500 ? '服务器内部错误' : (error.message || '请求失败'),
                        ...(status >= 500 ? { code: 'internal_error', requestId } : {})
                    });
                }
            }
            return res._toResponse() || new Response(null, { status: 204 });
        }
    };

    return api;
}

function express() {
    return createRouter();
}

express.Router = createRouter;
express.json = () => async (_req, _res, next) => next();

export default express;
