import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let configured;
let unconfigured;
const commit = '1234567890abcdef1234567890abcdef12345678';

before(async () => {
    configured = await createProductionHarness({ bindings: { APP_COMMIT_SHA: commit } });
    unconfigured = await createProductionHarness({ bindings: { APP_COMMIT_SHA: '' } });
});
after(async () => { await configured?.dispose(); await unconfigured?.dispose(); });

test('the public version endpoint reports only the configured commit and disables caching', async () => {
    const response = await configured.miniflare.dispatchFetch('http://marchcenter.local/api/version');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { commit });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
});

test('an unconfigured version is explicitly null', async () => {
    const response = await unconfigured.miniflare.dispatchFetch('http://marchcenter.local/api/version');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { commit: null });
});

test('the health contract stays unchanged and version does not accept writes', async () => {
    const health = await configured.miniflare.dispatchFetch('http://marchcenter.local/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, runtime: 'cloudflare-workers', database: 'd1' });
    const write = await configured.miniflare.dispatchFetch('http://marchcenter.local/api/version', { method: 'POST' });
    assert.equal(write.status, 404);
});
