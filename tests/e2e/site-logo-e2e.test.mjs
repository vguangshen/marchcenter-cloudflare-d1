import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

// 1×1 transparent PNG.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

let harness;
before(async () => { harness = await createProductionHarness(); });
after(async () => { await harness?.dispose(); });

test('an uploaded logo is served publicly as immutable image bytes', async () => {
    const uploaded = await harness.api('/api/logo-library', { body: { dataUrl: PNG_DATA_URL } });
    assert.equal(uploaded.status, 201, uploaded.text);

    const image = await harness.miniflare.dispatchFetch(`http://marchcenter.local/api/logo-library/${uploaded.data.id}/image`);
    assert.equal(image.status, 200, 'no sign-in needed: the login page shows the logo');
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.match(image.headers.get('cache-control'), /immutable/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    const bytes = new Uint8Array(await image.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG signature');

    for (const id of ['999999', '0', 'abc']) {
        const missing = await harness.miniflare.dispatchFetch(`http://marchcenter.local/api/logo-library/${id}/image`);
        assert.equal(missing.status, 404, id);
        await missing.body?.cancel();
    }

    const listedWithoutAuth = await harness.miniflare.dispatchFetch('http://marchcenter.local/api/logo-library');
    assert.equal(listedWithoutAuth.status, 401, 'the library listing itself stays admin-only');
    await listedWithoutAuth.body?.cancel();
});

test('site config accepts uploaded or https logo URLs and a logo background, and rejects unsafe URLs', async () => {
    const uploaded = await harness.api('/api/logo-library', { body: { dataUrl: PNG_DATA_URL } });
    const accepted = await harness.api('/api/config/site', { body: {
        navbarLogoType: 'custom',
        navbarLogoUrl: `/api/logo-library/${uploaded.data.id}/image`,
        navbarLogoBackground: 'none',
        loginVisualCenterImageUrl: 'https://cdn.example.com/center.webp'
    } });
    assert.equal(accepted.status, 200, accepted.text);
    const stored = await harness.api('/api/config/site');
    assert.equal(stored.data.navbarLogoBackground, 'none');

    for (const navbarLogoUrl of ['http://example.com/logo.png', 'javascript:alert(1)', PNG_DATA_URL, '/api/users/1', '//evil.example/logo.png']) {
        const rejected = await harness.api('/api/config/site', { body: { navbarLogoType: 'custom', navbarLogoUrl } });
        assert.equal(rejected.status, 400, navbarLogoUrl);
    }
    const badBackground = await harness.api('/api/config/site', { body: { navbarLogoBackground: 'rainbow' } });
    assert.equal(badBackground.status, 400);
});
