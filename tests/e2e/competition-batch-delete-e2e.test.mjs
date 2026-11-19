import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('bulk card deletion counts matched cards independently of duplicate IDs and cascaded rows', async () => {
    const harness = await createProductionHarness();
    try {
        const ids = Array.from({ length: 171 }, (_, index) => 1000 + index);
        const keep = 2000;
        await harness.run(`INSERT INTO competitions (id, title, url)
            SELECT value, 'fixture-' || value, 'https://training.example.invalid'
            FROM json_each(?)`, JSON.stringify([...ids, keep]));
        await harness.run(`INSERT INTO user_permissions (user_id, competition_id)
            SELECT 1, id FROM competitions WHERE id BETWEEN ? AND ?`, ids[0], keep);
        await harness.run(`INSERT INTO admin_entry_launch_tokens (token_hash, user_id, competition_id, expires_at)
            SELECT 'fixture-' || id, 1, id, 1000 FROM competitions WHERE id BETWEEN ? AND ?`, ids[0], keep);
        const body = { ids: [999, ...ids, String(ids[0]), ids.at(-1), 9999] };
        const result = await harness.api('/api/competitions/batch-delete', { body });
        assert.equal(result.status, 200, result.text);
        assert.equal(result.data.deleted, ids.length);
        assert.deepEqual(await harness.rows('SELECT id FROM competitions WHERE id >= 1000'), [{ id: keep }]);
        for (const table of ['user_permissions', 'admin_entry_launch_tokens']) {
            assert.deepEqual(await harness.rows(`SELECT competition_id FROM ${table} WHERE competition_id >= 1000`), [{ competition_id: keep }]);
        }
        const repeated = await harness.api('/api/competitions/batch-delete', { body });
        assert.equal(repeated.status, 200, repeated.text);
        assert.equal(repeated.data.deleted, 0);
    } finally { await harness.dispose(); }
});
