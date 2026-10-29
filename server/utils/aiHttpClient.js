import { safeHttpText } from './safeHttpClient.js';

export function resolveAiEndpoint(config) {
    const base = String(config.apiUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('请先配置 AI 接口地址');
    if (/\/(chat\/completions|messages)$/i.test(base)) return base;
    if (config.provider === 'anthropic') return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
    return `${base}/chat/completions`;
}

function parseData(text) {
    try { return JSON.parse(text); } catch { return { text }; }
}

// Use the same bounded Worker transport as model discovery and SSO: the
// deadline covers the response body and redirects remain visible to callers.
export async function requestAi(config, apiKey, messages, maxTokens, timeoutMs = 60_000) {
    const anthropic = config.provider === 'anthropic';
    const body = anthropic ? {
        model: config.modelName,
        ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
        messages: messages.filter(message => message.role !== 'system'),
        max_tokens: maxTokens
    } : { model: config.modelName, messages, max_tokens: maxTokens };
    const headers = anthropic
        ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const response = await safeHttpText(resolveAiEndpoint(config), {
        method: 'POST', headers, body: JSON.stringify(body), timeoutMs, maxResponseBytes: 2 * 1024 * 1024
    });
    const data = parseData(response.data);
    if (!response.ok) {
        const message = response.status >= 300 && response.status < 400
            ? 'AI 接口返回了重定向，请配置最终接口地址'
            : data?.error?.message || data?.message || `AI 接口请求失败：HTTP ${response.status}`;
        const error = new Error(message);
        // Keep route error-detail handling compatible with existing providers.
        error.response = { status: response.status, data };
        throw error;
    }
    return { ...response, data };
}
