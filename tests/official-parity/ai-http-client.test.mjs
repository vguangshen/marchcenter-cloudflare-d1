import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { requestAi } from '../../server/utils/aiHttpClient.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('AI requests preserve OpenAI-compatible model, messages, token count and authorization', async () => {
    const messages = [{ role: 'system', content: 'test system' }, { role: 'user', content: 'hello' }];
    let captured;
    globalThis.fetch = async (url, options) => {
        captured = { url: String(url), ...options };
        return Response.json({ choices: [{ message: { content: 'world' } }] });
    };
    const response = await requestAi({ apiUrl: 'https://ai.example/v1/', modelName: 'test-model' }, 'test-key', messages, 512);
    assert.equal(captured.url, 'https://ai.example/v1/chat/completions');
    assert.equal(captured.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(captured.body), { model: 'test-model', messages, max_tokens: 512 });
    assert.equal(captured.redirect, 'manual');
    assert.equal(response.data.choices[0].message.content, 'world');
});

test('Anthropic requests preserve version header and separate system instructions', async () => {
    let captured;
    globalThis.fetch = async (url, options) => {
        captured = { url: String(url), ...options };
        return Response.json({ content: [{ type: 'text', text: 'world' }] });
    };
    const response = await requestAi({ provider: 'anthropic', apiUrl: 'https://ai.example', modelName: 'test-model', systemPrompt: 'system' }, 'test-key', [{ role: 'system', content: 'ignore' }, { role: 'user', content: 'hello' }], 256);
    assert.equal(captured.url, 'https://ai.example/v1/messages');
    assert.equal(captured.headers['x-api-key'], 'test-key');
    assert.equal(captured.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(JSON.parse(captured.body), { model: 'test-model', system: 'system', messages: [{ role: 'user', content: 'hello' }], max_tokens: 256 });
    assert.equal(response.data.content[0].text, 'world');
});

test('canonical provider endpoints and readable error details remain compatible', async () => {
    let requested;
    globalThis.fetch = async url => { requested = String(url); return Response.json({ error: { message: 'provider rejected request' } }, { status: 429 }); };
    await assert.rejects(requestAi({ apiUrl: 'https://ai.example/v1/messages', provider: 'anthropic' }, 'test-key', [], 128), error => {
        assert.equal(error.response.status, 429);
        assert.equal(error.response.data.error.message, 'provider rejected request');
        return true;
    });
    assert.equal(requested, 'https://ai.example/v1/messages');
});

test('AI redirects remain visible and are never followed with a provider credential', async () => {
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
        calls += 1;
        assert.equal(options.redirect, 'manual');
        return new Response(null, { status: 302, headers: { Location: 'https://other.example/private' } });
    };
    await assert.rejects(requestAi({ apiUrl: 'https://ai.example/v1' }, 'test-key', [], 128), /最终接口地址/);
    assert.equal(calls, 1);
});

test('AI response byte limit is enforced while streaming', async () => {
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; }
    }));
    await assert.rejects(requestAi({ apiUrl: 'https://ai.example/v1' }, 'test-key', [], 128), /字节限制/);
    assert.equal(cancelled, true);
});

test('AI timeout covers a pending response body', { timeout: 2000 }, async () => {
    globalThis.fetch = async (_url, options) => new Response(new ReadableStream({
        start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason)); }
    }));
    await assert.rejects(requestAi({ apiUrl: 'https://ai.example/v1' }, 'test-key', [], 128, 25), /超时/);
});
