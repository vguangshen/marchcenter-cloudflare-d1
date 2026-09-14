import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MODULE_INIT_TIMEOUT_MS,
    initializePlatformModule
} from '../../../server/utils/platformJumpDispatcher.js';

const config = Object.freeze({
    method: 'java',
    baseUrl: 'https://training.example.test/YT00127'
});

function fixture(overrides = {}) {
    let captured;
    return {
        options: {
            urlValidator: async () => {},
            official: {
                timeoutMs: 2_000,
                fetchImplementation: async () => new Response('{}'),
                credentialsProvider: { async getCredentials() { return {}; } }
            },
            officialModuleInit: async (_config, _context, resolved) => {
                captured = resolved;
                return { initialized: true };
            },
            ...overrides
        },
        captured: () => captured
    };
}

test('module initialization uses an independent long timeout', async () => {
    const testFixture = fixture();
    await initializePlatformModule(config, {}, testFixture.options);
    assert.equal(testFixture.captured().timeoutMs, DEFAULT_MODULE_INIT_TIMEOUT_MS);
    assert.equal(DEFAULT_MODULE_INIT_TIMEOUT_MS, 120_000);
});

test('module initialization timeout remains explicitly configurable', async () => {
    const testFixture = fixture({ moduleInitTimeoutMs: 90_000 });
    await initializePlatformModule(config, {}, testFixture.options);
    assert.equal(testFixture.captured().timeoutMs, 90_000);
});
