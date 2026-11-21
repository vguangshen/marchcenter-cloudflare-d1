import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('web SQL backup restores platform catalogs, scores and class state into a migrated database', async () => {
    const harness = await createProductionHarness();
    const restored = new DatabaseSync(':memory:');
    try {
        const configId = await harness.seedConfig({ method: 'paasV2' });
        const competitionId = await harness.seedCompetition({ configId, method: 'paasV2' });
        // Wrangler rejects files containing this phrase, even inside string data.
        const catalog = JSON.stringify([{ title: "Today's task: BEGIN TRANSACTION; COMMIT;", plugFlag: 'fixture-task' }]);
        await harness.run("INSERT INTO paas_v2_platforms (id, software_unique, code, name) VALUES (99, 'backup-test', 'T1', 'Backup test')");
        await harness.run('INSERT INTO paas_v2_catalogs (platform_id, tasks_json) VALUES (99, ?)', catalog);
        await harness.run(`INSERT INTO user_agent_task_results
            (user_id, competition_id, sso_config_id, target_url, status, score)
            VALUES (1, ?, ?, 'https://example.invalid', 'completed', 88)`, competitionId, configId);
        await harness.run('INSERT INTO user_class_removals (user_id, competition_id) VALUES (1, ?)', competitionId);
        await harness.run('INSERT INTO system_initialization (singleton_id, initialized_by_user_id) VALUES (1, 1)');
        await harness.run('DELETE FROM paas_v2_platforms WHERE id = 1');

        const response = await harness.api('/api/database/backup', { method: 'POST' });
        assert.equal(response.status, 200);
        assert.equal(response.response.headers.get('cache-control'), 'no-store');
        // D1 refuses explicit transactions and ignores PRAGMA foreign_keys.
        assert.doesNotMatch(response.text, /BEGIN TRANSACTION|\bCOMMIT;\n|SAVEPOINT|PRAGMA foreign_keys/);
        assert.match(response.text, /^PRAGMA defer_foreign_keys = true;$/m);
        const migrations = new URL('../../migrations/', import.meta.url);
        for (const filename of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
            restored.exec(await readFile(new URL(filename, migrations), 'utf8'));
        }
        restored.exec(response.text);
        assert.equal(restored.prepare('SELECT tasks_json FROM paas_v2_catalogs WHERE platform_id = 99').get()?.tasks_json, catalog);
        assert.equal(restored.prepare('SELECT score FROM user_agent_task_results WHERE user_id = 1 AND competition_id = ?').get(competitionId)?.score, 88);
        assert.equal(restored.prepare('SELECT competition_id FROM user_class_removals WHERE user_id = 1').get()?.competition_id, competitionId);
        assert.equal(restored.prepare('SELECT initialized_by_user_id FROM system_initialization WHERE singleton_id = 1').get()?.initialized_by_user_id, 1);
        assert.equal(restored.prepare('SELECT id FROM paas_v2_platforms WHERE id = 1').get(), undefined);
        assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
        restored.close();
        await harness.dispose();
    }
});
