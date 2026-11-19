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

test('readiness depends on the current D1 schema while liveness remains available', async () => {
    const read = () => unconfigured.miniflare.dispatchFetch('http://marchcenter.local/api/ready');
    const available = await read();
    assert.equal(available.status, 200);
    assert.equal(available.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await available.json(), { ready: true });
    await unconfigured.run('ALTER TABLE paas_v2_platforms DROP COLUMN catalog_generation');
    assert.equal((await read()).status, 503);
    await unconfigured.run('ALTER TABLE paas_v2_platforms ADD COLUMN catalog_generation INTEGER NOT NULL DEFAULT 0');
    assert.equal((await read()).status, 200);
    await unconfigured.run('DROP TABLE user_agent_task_results');
    const unavailable = await read();
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { ready: false });
    const health = await unconfigured.miniflare.dispatchFetch('http://marchcenter.local/api/health');
    assert.equal(health.status, 200);
});
