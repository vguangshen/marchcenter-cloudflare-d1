import { safeHttpText } from './safeHttpClient.js';

const MAX_MODELS = 300;
const MAX_MODEL_NAME_LENGTH = 200;

function positiveInteger(...values) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return null;
}

function parseIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
    const parts = hostname.split('.').map(Number);
    return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
        ? parts
        : null;
}

function isPrivateHostname(hostname) {
    const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')
        || host.endsWith('.local') || host.endsWith('.internal')
        || host === 'metadata.google.internal') return true;
    const ipv4 = parseIpv4(host);
    if (ipv4) {
        const [a, b] = ipv4;
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && [18, 19].includes(b));
    }
    return host === '::1' || host === '::' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
}

export function resolveAiModelsEndpoint(apiUrl) {
    let url;
    try { url = new URL(String(apiUrl || '').trim()); }
    catch { throw new Error('请填写有效的 HTTPS 接口地址'); }
    if (url.protocol !== 'https:') throw new Error('模型识别仅支持 HTTPS 接口地址');
    if (url.username || url.password) throw new Error('接口地址不能包含账号或密码');
    if (isPrivateHostname(url.hostname)) throw new Error('模型识别不能访问本机或内网地址');
    url.search = '';
    url.hash = '';
    const trimmedPath = url.pathname.replace(/\/+$/, '');
    if (/\/models$/i.test(trimmedPath)) {
        url.pathname = trimmedPath;
    } else if (/\/(?:chat\/completions?|messages|responses)$/i.test(trimmedPath)) {
        url.pathname = trimmedPath.replace(/\/(?:chat\/completions?|messages|responses)$/i, '/models');
    } else {
        url.pathname = `${trimmedPath || ''}/models`;
    }
    return url.toString();
}

function normalizeModel(raw) {
    if (typeof raw === 'string') raw = { id: raw };
    if (!raw || typeof raw !== 'object') return null;
    const rawId = raw.id ?? raw.model ?? raw.modelName ?? raw.model_name
        ?? raw.baseModelId ?? raw.name;
    const id = String(rawId || '').replace(/^models\//, '').trim().slice(0, MAX_MODEL_NAME_LENGTH);
    if (!id) return null;
    const label = String(raw.displayName ?? raw.display_name ?? raw.label ?? id)
        .trim().slice(0, MAX_MODEL_NAME_LENGTH) || id;
    const maxOutputTokens = positiveInteger(
        raw.outputTokenLimit,
        raw.output_token_limit,
        raw.maxOutputTokens,
        raw.max_output_tokens,
        raw.maxCompletionTokens,
        raw.max_completion_tokens
    );
    const contextWindow = positiveInteger(
        raw.contextWindow,
        raw.context_window,
        raw.contextLength,
        raw.context_length,
        raw.maxContextLength,
        raw.max_context_length,
        raw.inputTokenLimit,
        raw.input_token_limit
    );
    const owner = String(raw.owned_by ?? raw.owner ?? raw.provider ?? '').trim().slice(0, 100);
    return {
        id,
        label,
        ...(owner ? { owner } : {}),
        ...(contextWindow ? { contextWindow } : {}),
        ...(maxOutputTokens ? { maxOutputTokens } : {})
    };
}

export function parseDiscoveredModels(payload) {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const candidates = Array.isArray(data)
        ? data
        : (Array.isArray(data?.data) ? data.data
            : (Array.isArray(data?.models) ? data.models
                : (Array.isArray(data?.results) ? data.results : [])));
    const unique = new Map();
    for (const raw of candidates.slice(0, MAX_MODELS * 2)) {
        const model = normalizeModel(raw);
        if (model && !unique.has(model.id)) unique.set(model.id, model);
        if (unique.size >= MAX_MODELS) break;
    }
    return [...unique.values()].sort((left, right) => (
        left.id.localeCompare(right.id, 'en', { numeric: true, sensitivity: 'base' })
    ));
}

function discoveryHeaders(provider, apiKey) {
    if (provider === 'anthropic') {
        return {
            Accept: 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        };
    }
    return {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(provider === 'google' ? { 'x-goog-api-key': apiKey } : {})
    };
}

function upstreamError(response) {
    let detail = '';
    try {
        const data = JSON.parse(response.data || '{}');
        detail = String(data?.error?.message || data?.message || '').trim();
    } catch { /* keep the status-only message */ }
    const error = new Error(detail || `上游模型接口返回 HTTP ${response.status}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    return error;
}

export async function discoverAiModels(config, apiKey, request = safeHttpText) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('请先填写 API Key');
    const endpoint = resolveAiModelsEndpoint(config?.apiUrl);
    const response = await request(endpoint, {
        method: 'GET',
        headers: discoveryHeaders(config?.provider, key),
        timeoutMs: 15000,
        maxResponseBytes: 512 * 1024
    });
    if (!response.ok) throw upstreamError(response);
    let models;
    try { models = parseDiscoveredModels(response.data); }
    catch { throw new Error('上游模型接口返回的不是有效 JSON'); }
    if (!models.length) {
        const error = new Error('上游没有返回可用模型，请保留手动填写');
        error.statusCode = 422;
        throw error;
    }
    return { endpoint, models };
}
