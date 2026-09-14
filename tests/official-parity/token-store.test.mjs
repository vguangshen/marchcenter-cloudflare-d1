import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createOfficialTokenStore,
    OFFICIAL_TOKEN_TTL_MS
} from '../../server/utils/officialCompat/tokenStore.js';

test('JAVA token uses a one-hour expire-after-write TTL', () => {
    let clock = 1_000;
    const store = createOfficialTokenStore({ now: () => clock });
    store.set('https://sandbox.invalid/open', 'token-1');

    clock += OFFICIAL_TOKEN_TTL_MS - 1;
    assert.equal(store.get('https://sandbox.invalid/open'), 'token-1');

    clock += 1;
    assert.equal(store.get('https://sandbox.invalid/open'), null);
});

test('rewriting a token restarts the one-hour TTL', () => {
    let clock = 0;
    const store = createOfficialTokenStore({ now: () => clock });
    store.set('/open', 'first');
    clock += 30 * 60 * 1000;
    store.set('/open', 'second');
    clock += 30 * 60 * 1000;
    assert.equal(store.get('/open'), 'second');
});

test('the same store instance reuses a token across calls', () => {
    const store = createOfficialTokenStore({ now: () => 100 });
    store.set('/open', 'reused-token');
    assert.equal(store.get('/open'), 'reused-token');
    assert.equal(store.get('/open'), 'reused-token');
});

test('writing an empty token invalidates the entry immediately', () => {
    const store = createOfficialTokenStore({ now: () => 100 });
    store.set('/open', 'old-token');
    assert.equal(store.set('/open', ''), null);
    assert.equal(store.get('/open'), null);
    assert.equal(store.has('/open'), false);
});

test('a new store instance starts empty and can safely acquire its own token', () => {
    const first = createOfficialTokenStore({ now: () => 100 });
    const second = createOfficialTokenStore({ now: () => 100 });
    first.set('/open', 'first-token');
    assert.equal(second.get('/open'), null);
    second.set('/open', 'second-token');
    assert.equal(second.get('/open'), 'second-token');
    assert.equal(first.get('/open'), 'first-token');
});

test('the token store does not log or expose tokens, passwords or auth headers', () => {
    const originalLog = console.log;
    const originalError = console.error;
    const messages = [];
    console.log = (...values) => messages.push(values.join(' '));
    console.error = (...values) => messages.push(values.join(' '));
    try {
        const store = createOfficialTokenStore({ now: () => 100 });
        store.set('/open', 'top-secret-token');
        store.get('/open');
        store.delete('/open');
        assert.equal(JSON.stringify(store), '{}');
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    assert.deepEqual(messages, []);
});
