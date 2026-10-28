import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let harness;
const requests = [];
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

before(async () => {
    harness = await createProductionHarness();
    harness.platform.fetch = async request => {
        requests.push(request.url);
        if (request.url.includes('/unavailable.png')) return new Response('Unavailable', { status: 503 });
        return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    };
});
after(async () => { await harness?.dispose(); });

test('public HTTP(S) covers cache through the mocked outbound service and existing cache paths stay local', async () => {
    requests.length = 0;
    const urls = ['https://resource.zuoyizuo.com/covers/one.png', 'http://fcdn.example.invalid/two.png'];
    const cached = await harness.api('/api/paas-v2/covers/cache', { body: { urls } });
    assert.equal(cached.status, 200, cached.text);
    assert.deepEqual(requests.sort(), urls.slice().sort());
    for (const url of urls) assert.match(cached.data.covers[url], /^\/api\/paas-v2\/covers\/[a-f0-9]{32}\.png$/);
    const storedPath = cached.data.covers[urls[0]];
    const stored = await harness.miniflare.dispatchFetch(`http://marchcenter.local${storedPath}`);
    assert.equal(stored.status, 200);
    assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), png);
    requests.length = 0;
    const alreadyCached = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [storedPath] } });
    assert.equal(alreadyCached.data.covers[storedPath], storedPath);
    assert.deepEqual(requests, []);
});

test('ordinary public upstream failure retains the existing original-URL fallback', async () => {
    const url = 'https://images.example.invalid/unavailable.png';
    requests.length = 0;
    const response = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [url] } });
    assert.equal(response.status, 200);
    assert.equal(response.data.covers[url], url);
    assert.equal(response.data.code, undefined);
    assert.ok(requests.length > 0);
});

test('disallowed cover URLs return the production downgrade code before any request in the batch is fetched', async () => {
    const disallowed = [
        'file:///etc/passwd', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
        'https://name:secret@images.example.invalid/private.png', 'http://localhost/cover.png',
        'http://127.0.0.1/cover.png', 'http://2130706433/cover.png', 'http://10.0.0.2/cover.png',
        'http://169.254.169.254/cover.png', 'http://[::1]/cover.png',
        'http://[::ffff:127.0.0.1]/cover.png', 'http://service.internal/cover.png', '/unrelated/cover.png'
    ];
    for (const url of disallowed) {
        requests.length = 0;
        const response = await harness.api('/api/paas-v2/covers/cache', {
            body: { urls: ['https://resource.zuoyizuo.com/must-not-fetch.png', url] }
        });
        assert.equal(response.status, 400, url);
        assert.equal(response.data.code, 'cover_url_not_allowed', url);
        assert.deepEqual(requests, [], url);
    }
});
