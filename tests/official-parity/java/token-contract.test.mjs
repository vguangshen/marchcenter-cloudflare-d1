import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createOfficialTokenStore } from '../../../server/utils/officialCompat/tokenStore.js';
import { createJavaHttpTransport } from '../../../server/utils/officialCompat/java/javaHttpTransport.js';
import { createJavaTokenClient } from '../../../server/utils/officialCompat/java/tokenClient.js';
import { createFetchPlan, TEST_CREDENTIALS, tokenSuccess } from './helpers.mjs';

test('official JAVA capture fixture is loopback-only and every scenario is labeled', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/official-java-captures.json', import.meta.url), 'utf8'));
    assert.equal(fixture.nonLoopbackConnections, 0);
    assert.equal(fixture.scenarios.length, 29);
    assert.ok(fixture.scenarios.every(item => item.evidenceLevel === 'official-captured'));
    assert.ok(fixture.scenarios.every(item => item.fallbackResponseUsed === false));
});

test('tokenInfo uses POST /open/tokenInfo and captured password-tokenNum header order', async () => {
    const mock = createFetchPlan({ '/open/tokenInfo': [tokenSuccess('TOKEN')] });
    const client = createJavaTokenClient({
        openBaseUrl: 'https://local.invalid/open', tokenStore: createOfficialTokenStore(),
        transport: createJavaHttpTransport({ fetchImplementation: mock.fetchImplementation }), credentials: TEST_CREDENTIALS
    });
    assert.equal(await client.getToken(), 'TOKEN');
    assert.equal(mock.calls[0].method, 'POST');
    assert.equal(mock.calls[0].path, '/open/tokenInfo');
    assert.equal(mock.calls[0].headers.platformToken, '{"password":"local-test-password","tokenNum":"INTERFACE-TEST"}');
    assert.equal(mock.calls[0].body, '');
});

test('token cache key is exactly base URL plus /open and base URLs are isolated', async () => {
    const store = createOfficialTokenStore();
    store.set('https://a.invalid/open', 'A'); store.set('https://b.invalid/open', 'B');
    assert.equal(store.get('https://a.invalid/open'), 'A');
    assert.equal(store.get('https://b.invalid/open'), 'B');
});
