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
        if (request.url.includes('/missing.png')) return new Response('Missing', { status: 404 });
        if (request.url.includes('/active.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
        if (request.url.includes('/invalid.png')) return new Response('not an image', { headers: { 'Content-Type': 'text/plain' } });
        if (request.url.includes('/oversized-length.png')) return new Response(png, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(5 * 1024 * 1024 + 1) } });
        if (request.url.includes('/oversized-stream.png')) {
            let chunks = 0;
            return new Response(new ReadableStream({
                pull(controller) {
                    if (chunks++ >= 8) { controller.close(); return; }
                    const chunk = new Uint8Array(1024 * 1024);
                    if (chunks === 1) chunk.set(png);
                    controller.enqueue(chunk);
                }
            }), { headers: { 'Content-Type': 'image/png' } });
        }
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
    assert.equal(requests.length, 2, 'transient upstream failures get at most one retry');
});

test('repeat source URLs reuse R2 and duplicates in one batch download once', async () => {
    const url = 'https://images.example.invalid/duplicate.png';
    requests.length = 0;
    const first = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [url, url] } });
    assert.equal(first.status, 200, first.text);
    assert.equal(requests.length, 1);
    requests.length = 0;
    const second = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [url] } });
    assert.deepEqual(second.data, first.data);
    assert.equal(requests.length, 0);
});

test('invalid images, permanent errors and declared or streamed oversized images retain the URL without retries', async () => {
    for (const filename of ['missing.png', 'invalid.png', 'oversized-length.png', 'oversized-stream.png']) {
        const url = `https://images.example.invalid/${filename}`;
        requests.length = 0;
        const result = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [url] } });
        assert.equal(result.status, 200, result.text);
        assert.equal(result.data.covers[url], url, filename);
        assert.equal(requests.length, 1, filename);
    }
    const bucket = await harness.miniflare.getR2Bucket('WALLPAPERS');
    const stored = await bucket.list({ prefix: 'paas-v2-covers/' });
    assert.equal(stored.objects.length, 3, 'only the three valid images from this fixture are cached');
});

test('cover batches above the resource limit are rejected before outbound work', async () => {
    requests.length = 0;
    const result = await harness.api('/api/paas-v2/covers/cache', { body: {
        urls: Array.from({ length: 101 }, (_, index) => `https://images.example.invalid/${index}.png`)
    } });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'cover_batch_too_large');
    assert.equal(requests.length, 0);
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

test('active image formats such as SVG are never stored on this origin', async () => {
    const url = 'https://images.example.invalid/active.svg';
    const response = await harness.api('/api/paas-v2/covers/cache', { body: { urls: [url] } });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.data.covers[url], url, 'the original URL is kept instead of a same-origin copy');
});
