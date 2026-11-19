import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let harness;
before(async () => { harness = await createProductionHarness(); });
after(async () => { await harness?.dispose(); });

test('platform cloud CRUD keeps identity case-insensitive and updates/deletes its tasks atomically', async () => {
    const created = await harness.api('/api/paas-v2/platforms', { body: { code: 'PT0499', name: '测试平台', softwareUnique: 'Cloud-Test', theme: 'cyan' } });
    assert.equal(created.status, 201);
    const duplicate = await harness.api('/api/paas-v2/platforms', { body: { code: 'PT0498', name: '重复', softwareUnique: 'cloud-test' } });
    assert.equal(duplicate.status, 409);
    const result = await harness.run("INSERT INTO competitions (title, url, category, sso_method, paas_v2_software_unique, paas_v2_plug_flag) VALUES ('测试任务', 'https://training.example.invalid/enter', '旧分类', 'paasV2', 'CLOUD-TEST', 'task-1')");
    const competitionId = result.meta.last_row_id;
    await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (1, ?)', competitionId);
    const renamed = await harness.api('/api/paas-v2/platforms/cloud-test', { method: 'PUT', body: { code: 'PT0499', name: '改名后平台', softwareUnique: 'Renamed-Cloud', theme: 'rose' } });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await harness.rows('SELECT category, paas_v2_software_unique FROM competitions WHERE id = ?', competitionId), [{ category: '改名后平台', paas_v2_software_unique: 'Renamed-Cloud' }]);
    const list = await harness.api('/api/paas-v2/platforms');
    const platform = list.data.find(item => item.softwareUnique === 'Renamed-Cloud');
    assert.equal(platform.taskCount, 1);
    assert.equal(platform.theme, 'rose');
    const removed = await harness.api('/api/paas-v2/platforms/renamed-cloud', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal((await harness.rows('SELECT id FROM competitions WHERE id = ?', competitionId)).length, 0);
    assert.equal((await harness.rows('SELECT * FROM user_permissions WHERE competition_id = ?', competitionId)).length, 0);
});

test('legacy platform import preserves cloud edits and rejects invalid batches without partial imports', async () => {
    const first = await harness.api('/api/paas-v2/platforms/import', { body: { platforms: [
        { code: 'CUSTOM', name: '从本地导入', softwareUnique: 'legacy-test' },
        { code: 'MKT', name: '本地内置重命名', softwareUnique: 'scyxcjrh' }
    ] } });
    assert.equal(first.status, 200);
    assert.equal(first.data.platforms.find(item => item.softwareUnique === 'scyxcjrh').name, '本地内置重命名');
    await harness.api('/api/paas-v2/platforms/legacy-test', { method: 'PUT', body: { code: 'CLOUD', name: '云端新名称', softwareUnique: 'legacy-test' } });
    const second = await harness.api('/api/paas-v2/platforms/import', { body: { platforms: [{ code: 'OLD', name: '旧本地覆盖', softwareUnique: 'LEGACY-TEST' }] } });
    assert.equal(second.data.platforms.find(item => item.softwareUnique === 'legacy-test').name, '云端新名称');
    const invalid = await harness.api('/api/paas-v2/platforms/import', { body: { platforms: [{ code: 'OK', name: '不得部分导入', softwareUnique: 'must-not-save' }, { code: 'BAD', name: '错误平台', softwareUnique: '../bad' }] } });
    assert.equal(invalid.status, 400);
    assert.equal((await harness.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'must-not-save'")).length, 0);
});

test('catalog returns saved cloud data and uses that data when a forced refresh fails', async () => {
    const [platform] = await harness.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'scyxcjrh'");
    const tasks = [{ plugFlag: 'saved-task', title: '已保存任务', answerType: '1,2,3,4' }];
    await harness.run('INSERT INTO paas_v2_catalogs (platform_id, tasks_json) VALUES (?, ?)', platform.id, JSON.stringify(tasks));
    await harness.run("UPDATE paas_v2_platforms SET catalog_sync_status = 'ok', catalog_synced_at = CURRENT_TIMESTAMP WHERE id = ?", platform.id);
    const cached = await harness.api('/api/paas-v2/catalog?softwareUnique=SCYXCJRH');
    assert.equal(cached.status, 200);
    assert.equal(cached.data.source, 'database');
    const expectedTasks = tasks.map(task => ({ ...task, answerType: '1' }));
    assert.deepEqual(cached.data.tasks, expectedTasks);
    const fallback = await harness.api('/api/paas-v2/catalog?softwareUnique=scyxcjrh&force=1');
    assert.equal(fallback.status, 200);
    assert.equal(fallback.data.source, 'database-fallback');
    assert.deepEqual(fallback.data.tasks, expectedTasks);
    assert.ok(fallback.data.refreshError);
});

test('a custom identifier change invalidates the catalog and discards older in-flight refreshes', async () => {
    const original = 'catalog-original';
    const renamed = 'catalog-renamed';
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const fixture = task => Response.json({ code: 0, data: { taskJson: [{ plugId: task, taskTitle: task }] } });
    let heldRequest;
    const create = await harness.api('/api/paas-v2/platforms', { body: { softwareUnique: original, code: 'CAT', name: 'Original name' } });
    assert.equal(create.status, 201, create.text);
    let originalReads = 0;
    const send = harness.platform.fetch;
    harness.platform.fetch = async request => {
        if (new URL(request.url).hostname !== 'paas.itmc.org.cn') return send(request);
        const identifier = new URLSearchParams(await request.text()).get('token');
        if (identifier === renamed) return fixture('renamed-task');
        assert.equal(identifier, original);
        originalReads++;
        if (originalReads === 2) {
            entered.resolve();
            await release.promise;
            return fixture('outdated-task');
        }
        return fixture(originalReads === 1 ? 'original-task' : 'refetched-task');
    };
    const read = (identifier, force = false) => harness.api(`/api/paas-v2/catalog?softwareUnique=${identifier}${force ? '&force=1' : ''}`);
    const update = (before, softwareUnique) => harness.api(`/api/paas-v2/platforms/${before}`, {
        method: 'PUT', body: { softwareUnique, code: 'CAT', name: 'Updated name' }
    });
    try {
        assert.deepEqual((await read(original)).data.tasks.map(task => task.plugFlag), ['original-task']);
        assert.equal((await update(original, original)).status, 200);
        assert.equal((await read(original)).data.source, 'database');

        heldRequest = read(original, true);
        await Promise.race([entered.promise, heldRequest.then(result => assert.fail(result.text))]);
        assert.equal((await update(original, renamed)).status, 200);
        const changed = await read(renamed);
        assert.equal(changed.data.source, 'remote');
        assert.deepEqual(changed.data.tasks.map(task => task.plugFlag), ['renamed-task']);
        assert.equal((await update(renamed, original)).status, 200);

        release.resolve();
        assert.equal((await heldRequest).status, 409);
        const [platform] = await harness.rows('SELECT catalog_sync_status, catalog_synced_at FROM paas_v2_platforms WHERE id = ?', create.data.id);
        assert.deepEqual(platform, { catalog_sync_status: 'never', catalog_synced_at: null });
        const fresh = await read(original);
        assert.equal(fresh.data.source, 'remote');
        assert.deepEqual(fresh.data.tasks.map(task => task.plugFlag), ['refetched-task']);
    } finally {
        release.resolve();
        await heldRequest?.catch(() => {});
        harness.platform.fetch = send;
    }
});

test('batch import fixes the answer type, is idempotent, and rejects invalid input before writing', async () => {
    await harness.seedConfig({ method: 'paasV2', jumpBaseUrl: 'https://training.example.invalid/enter' });
    const tasks = ['one', 'two'].map((plugFlag, index) => ({ title: `任务${index}`, url: 'https://training.example.invalid/enter', ssoMethod: 'paasV2', paasV2PlugFlag: plugFlag, paasV2SoftwareUnique: 'batch-platform', paasV2AnswerType: index ? '2,4' : '1,2,3,4' }));
    const first = await harness.api('/api/competitions/batch-paas-v2', { body: { tasks } });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.data.created, 2);
    const duplicate = await harness.api('/api/competitions/batch-paas-v2', { body: { tasks: [...tasks, tasks[0]] } });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.created, 0);
    assert.equal((await harness.rows("SELECT id FROM competitions WHERE paas_v2_software_unique = 'batch-platform'")).length, 2);
    assert.deepEqual((await harness.rows("SELECT paas_v2_answer_type AS answerType FROM competitions WHERE paas_v2_software_unique = 'batch-platform' ORDER BY id")).map(row => row.answerType), ['1', '1']);
    const invalid = await harness.api('/api/competitions/batch-paas-v2', { body: { tasks: [{ ...tasks[0], paasV2PlugFlag: 'must-not-save' }, { ...tasks[1], url: 'javascript:alert(1)' }] } });
    assert.notEqual(invalid.status, 200);
    assert.equal((await harness.rows("SELECT id FROM competitions WHERE paas_v2_plug_flag = 'must-not-save'")).length, 0);
});

test('a student can read platform metadata but cannot mutate cloud platforms or batch-import tasks', async () => {
    await harness.seedUser({ id: 99, username: 'platform-student', role: 'student' });
    const token = await harness.issueToken({ id: 99, username: 'platform-student', role: 'student' });
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await harness.api('/api/paas-v2/platforms', { headers })).status, 200);
    assert.equal((await harness.api('/api/paas-v2/platforms', { headers, body: { code: 'NO', name: '无权限', softwareUnique: 'denied' } })).status, 403);
    assert.equal((await harness.api('/api/competitions/batch-paas-v2', { headers, body: { tasks: [] } })).status, 403);
});

test('platform metadata counts catalogs in SQL and indexed task counts keep case-insensitive semantics', async () => {
    const [platform] = await harness.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'scyxcjrh'");
    for (const [json, count] of [['[{},{}]', 2], ['{}', 0], ['invalid-json', 0]]) {
        await harness.run('INSERT INTO paas_v2_catalogs (platform_id, tasks_json) VALUES (?, ?) ON CONFLICT(platform_id) DO UPDATE SET tasks_json = excluded.tasks_json', platform.id, json);
        const result = await harness.api('/api/paas-v2/platforms');
        assert.equal(result.status, 200, result.text);
        assert.equal(result.data.find(row => row.id === platform.id).catalogTaskCount, count);
    }
    const plan = await harness.rows("EXPLAIN QUERY PLAN SELECT id FROM competitions WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE AND paas_v2_plug_flag = ? COLLATE NOCASE", 'SCYXCJRH', 'task-1');
    assert.ok(plan.some(row => row.detail.includes('idx_competitions_paas_v2_platform_task')
        && row.detail.includes('paas_v2_software_unique=? AND paas_v2_plug_flag=?')), JSON.stringify(plan));
});
