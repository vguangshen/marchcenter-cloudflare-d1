import assert from 'node:assert/strict';
import test from 'node:test';
import {
    discoverAiModels, parseDiscoveredModels, resolveAiModelsEndpoint
} from '../../server/utils/aiModelDiscovery.js';

test('model discovery derives the models endpoint from supported completion URLs', () => {
    assert.equal(
        resolveAiModelsEndpoint('https://api.openai.com/v1/chat/completions'),
        'https://api.openai.com/v1/models'
    );
    assert.equal(
        resolveAiModelsEndpoint('https://api.anthropic.com/v1/messages'),
        'https://api.anthropic.com/v1/models'
    );
    assert.equal(
        resolveAiModelsEndpoint('https://gateway.example.test/openai/v1/'),
        'https://gateway.example.test/openai/v1/models'
    );
    assert.throws(
        () => resolveAiModelsEndpoint('https://127.0.0.1/v1/chat/completions'),
        /本机或内网/
    );
    assert.throws(
        () => resolveAiModelsEndpoint('http://api.example.test/v1/chat/completions'),
        /HTTPS/
    );
});

test('model discovery normalizes upstream model metadata without guessing output limits', () => {
    assert.deepEqual(parseDiscoveredModels({ data: [
        { id: 'plain-chat', owned_by: 'gateway', context_window: 128000 },
        { name: 'models/gemini-flash', displayName: 'Gemini Flash', inputTokenLimit: 1000000, outputTokenLimit: 64000 },
        { id: 'plain-chat', max_output_tokens: 1000 }
    ] }), [
        { id: 'gemini-flash', label: 'Gemini Flash', contextWindow: 1000000, maxOutputTokens: 64000 },
        { id: 'plain-chat', label: 'plain-chat', owner: 'gateway', contextWindow: 128000 }
    ]);
});

test('model discovery uses provider authentication and bounded server-side transport', async () => {
    let captured;
    const result = await discoverAiModels({
        provider: 'anthropic',
        apiUrl: 'https://api.anthropic.com/v1/messages'
    }, 'secret-key', async (url, options) => {
        captured = { url, options };
        return {
            ok: true,
            status: 200,
            data: JSON.stringify({ data: [{ id: 'claude-test' }] })
        };
    });
    assert.equal(captured.url, 'https://api.anthropic.com/v1/models');
    assert.equal(captured.options.headers['x-api-key'], 'secret-key');
    assert.equal(captured.options.headers['anthropic-version'], '2023-06-01');
    assert.equal(captured.options.timeoutMs, 15000);
    assert.equal(captured.options.maxResponseBytes, 512 * 1024);
    assert.deepEqual(result.models, [{ id: 'claude-test', label: 'claude-test' }]);
});
