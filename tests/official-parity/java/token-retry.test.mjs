import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialTokenStore, OFFICIAL_TOKEN_TTL_MS } from '../../../server/utils/officialCompat/tokenStore.js';
import { createJavaHttpTransport } from '../../../server/utils/officialCompat/java/javaHttpTransport.js';
import { createJavaTokenClient } from '../../../server/utils/officialCompat/java/tokenClient.js';
import { createFetchPlan, failure, TEST_CREDENTIALS, tokenSuccess } from './helpers.mjs';

function clientFor(responses, store = createOfficialTokenStore()) {
    const mock = createFetchPlan({ '/open/tokenInfo': responses });
    return { ...mock, store, client: createJavaTokenClient({
        openBaseUrl: 'https://local.invalid/open', tokenStore: store,
        transport: createJavaHttpTransport({ fetchImplementation: mock.fetchImplementation }), credentials: TEST_CREDENTIALS
    }) };
}

test('empty response and non-10000 retry up to three times', async () => {
    for (const responses of [
        [{ body: '' }, { body: '' }, tokenSuccess('third')],
        [failure(10010), failure(10010), tokenSuccess('third')],
        [{ status: 503 }, { status: 503 }, tokenSuccess('third')],
        [new TypeError('network-1'), new TypeError('network-2'), tokenSuccess('third')]
    ]) {
        const subject = clientFor(responses);
        assert.equal(await subject.client.getToken(), 'third');
        assert.equal(subject.calls.length, 3);
    }
});

test('three token failures reject and malformed JSON does not retry', async () => {
    const exhausted = clientFor([failure(10010), failure(10010), failure(10010)]);
    await assert.rejects(exhausted.client.getToken(), { code: 'OFFICIAL_JAVA_TOKEN_RETRIES_EXHAUSTED' });
    assert.equal(exhausted.calls.length, 3);
    const malformed = clientFor([{ body: '{invalid' }]);
    await assert.rejects(malformed.client.getToken(), { code: 'OFFICIAL_JAVA_RESULT_INVALID' });
    assert.equal(malformed.calls.length, 1);
});

test('same instance reuses, empty clear refetches, new instance is isolated and rewrite resets TTL', async () => {
    let now = 0;
    const store = createOfficialTokenStore({ now: () => now });
    const subject = clientFor([tokenSuccess('one'), tokenSuccess('two')], store);
    assert.equal(await subject.client.getToken(), 'one'); assert.equal(await subject.client.getToken(), 'one');
    assert.equal(subject.calls.length, 1);
    subject.client.clear(); assert.equal(await subject.client.getToken(), 'two');
    now += OFFICIAL_TOKEN_TTL_MS - 1; assert.equal(store.get('https://local.invalid/open'), 'two');
    store.set('https://local.invalid/open', 'rewritten'); now += OFFICIAL_TOKEN_TTL_MS - 1;
    assert.equal(store.get('https://local.invalid/open'), 'rewritten');
    const separate = createOfficialTokenStore({ now: () => now });
    assert.equal(separate.get('https://local.invalid/open'), null);
});
