import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const apiKey = 'sk-ai-route-fixture-not-a-real-key';
const config = {
    provider: 'openai', apiUrl: 'https://ai.example.invalid/v1/',
    modelName: 'route-fixture-model', maxTokens: 4096, systemPrompt: '请用中文回答。'
};
const calls = [];
let harness;
let studentHeaders;
let mode;

before(async () => {
    harness = await createProductionHarness();
    await harness.seedUser({ id: 2, username: 'ai-route-student', role: 'student' });
    const token = await harness.issueToken({ id: 2, username: 'ai-route-student', role: 'student' });
    studentHeaders = { Authorization: `Bearer ${token}` };
    harness.platform.fetch = async request => {
        const url = new URL(request.url);
        assert.equal(url.origin, 'https://ai.example.invalid', 'all AI requests must remain in the mock fixture');
        calls.push({ url: request.url, method: request.method, headers: request.headers, body: await request.json() });
        if (mode === 'unauthorized') return Response.json({ error: { message: 'fixture upstream credential rejected' } }, { status: 401 });
        if (mode === 'redirect') return new Response('', { status: 302, headers: { Location: 'https://unreachable.example.invalid/collect' } });
        return Response.json({ choices: [{ message: { content: [{ type: 'text', text: '【难度评估】' }, { type: 'text', text: '循序渐进练习。' }] } }] });
    };
});
after(async () => { await harness?.dispose(); });

async function saveConfig(overrides = {}) {
    const result = await harness.api('/api/ai/config', { method: 'PUT', body: { ...config, apiKey, ...overrides } });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.data.success, true);
}

beforeEach(async () => {
    calls.length = 0;
    mode = 'success';
    await saveConfig();
});

test('saved AI settings generate through the Worker transport with the resolved URL, key and prompt', async () => {
    const result = await harness.api('/api/ai/generate', { body: { title: '测试竞赛', category: '程序设计', description: '算法与数据结构' } });
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(result.data, { content: '【难度评估】\n循序渐进练习。' });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, 'https://ai.example.invalid/v1/chat/completions');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.get('authorization'), `Bearer ${apiKey}`);
    assert.match(call.headers.get('content-type'), /application\/json/);
    assert.equal(call.body.model, config.modelName);
    assert.equal(call.body.max_tokens, config.maxTokens);
    assert.deepEqual(call.body.messages[0], { role: 'system', content: config.systemPrompt });
    assert.equal(call.body.messages[1].role, 'user');
    for (const value of ['测试竞赛', '程序设计', '算法与数据结构']) assert.ok(call.body.messages[1].content.includes(value));
    const [settings] = await harness.rows('SELECT config_json, encrypted_api_key FROM ai_settings WHERE id = 1');
    assert.equal(settings.config_json.includes(apiKey), false);
    assert.notEqual(settings.encrypted_api_key, apiKey);
    assert.equal(settings.encrypted_api_key.includes(apiKey), false);
    assert.equal(result.text.includes(apiKey), false);
});

test('connection test honors a complete endpoint and returns verified status without the upstream response', async () => {
    const result = await harness.api('/api/ai/test', { body: { apiUrl: 'https://ai.example.invalid/custom/chat/completions' } });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.data.success, true);
    assert.equal(result.data.responseVerified, true);
    assert.equal(result.data.modelName, config.modelName);
    assert.ok(result.data.latencyMs >= 0);
    assert.equal(result.text.includes(apiKey), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ai.example.invalid/custom/chat/completions');
    assert.equal(calls[0].headers.get('authorization'), `Bearer ${apiKey}`);
    assert.equal(calls[0].body.max_tokens, 128);
    assert.deepEqual(calls[0].body.messages.at(-1), { role: 'user', content: '这是连接测试，请只回复 OK。' });
});

test('authentication protects AI calls while ordinary users can generate without reading or changing the key', async () => {
    for (const pathname of ['/api/ai/generate', '/api/ai/test']) {
        const result = await harness.api(pathname, { headers: { Authorization: '' }, body: {} });
        assert.equal(result.status, 401, result.text);
    }
    for (const [pathname, method] of [['/api/ai/config', 'PUT'], ['/api/ai/test', 'POST']]) {
        const result = await harness.api(pathname, { method, headers: studentHeaders, body: { ...config, apiKey: 'attempted-replacement' } });
        assert.equal(result.status, 403, result.text);
    }
    assert.equal(calls.length, 0, 'rejected requests must not contact the AI provider');
    const visibleConfig = await harness.api('/api/ai/config', { headers: studentHeaders });
    assert.equal(visibleConfig.status, 200, visibleConfig.text);
    assert.equal(visibleConfig.data.apiKey, '');
    assert.equal(visibleConfig.data.hasApiKey, true);
    assert.equal(visibleConfig.text.includes(apiKey), false);
    const result = await harness.api('/api/ai/generate', { headers: studentHeaders, body: { title: '普通用户备赛' } });
    assert.equal(result.status, 200, result.text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('authorization'), `Bearer ${apiKey}`);
});

test('AI routes preserve provider error details and never follow credential-bearing redirects', async () => {
    mode = 'unauthorized';
    const rejected = await harness.api('/api/ai/generate', { body: { title: '拒绝测试' } });
    assert.equal(rejected.status, 400, rejected.text);
    assert.equal(rejected.data.error, 'fixture upstream credential rejected');
    mode = 'redirect';
    const redirected = await harness.api('/api/ai/test', { body: {} });
    assert.equal(redirected.status, 502, redirected.text);
    assert.match(redirected.data.error, /重定向/);
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(harness.logs).includes(apiKey), false);
});
