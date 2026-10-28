import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('map configuration is available only to user managers and exposes the public client contract', async () => {
    const harness = await createProductionHarness();
    try {
        const managerConfig = await harness.api('/api/map/config');
        assert.equal(managerConfig.status, 200);
        assert.deepEqual(Object.keys(managerConfig.data).sort(), ['key', 'serviceHost']);
        assert.equal(typeof managerConfig.data.key, 'string');
        assert.equal(typeof managerConfig.data.serviceHost, 'string');
        assert.equal(managerConfig.response.headers.get('cache-control'), 'no-store');
        const anonymous = await harness.miniflare.dispatchFetch('http://marchcenter.local/api/map/config');
        assert.equal(anonymous.status, 401);
        await harness.seedUser({ id: 2, username: 'map-student', role: 'student' });
        const studentToken = await harness.issueToken({ id: 2, username: 'map-student', role: 'student' });
        const student = await harness.api('/api/map/config', { headers: { Authorization: `Bearer ${studentToken}` } });
        assert.equal(student.status, 403);
    } finally { await harness.dispose(); }
});
