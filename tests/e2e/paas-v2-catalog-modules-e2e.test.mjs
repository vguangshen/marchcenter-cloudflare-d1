import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('module-only sync before the first full catalog read still fetches all upstream tasks', async () => {
    const harness = await createProductionHarness({ bindings: { DAYU_COVER_USERNAME: '', DAYU_COVER_PASSWORD: '' } });
    try {
        let sourceReads = 0;
        harness.platform.fetch = async request => {
            assert.equal(new URL(request.url).hostname, 'paas.itmc.org.cn');
            sourceReads++;
            return Response.json({ code: 0, data: {
                taskModuleJson: [{ id: 1, moduleTitle: '官方分类' }],
                taskJson: [
                    { plugId: 'grouped', taskTitle: '分类内任务', taskModuleId: 1 },
                    { plugId: 'ungrouped', taskTitle: '无分类任务' }
                ]
            } });
        };
        const softwareUnique = 'dzswcjrh';
        const refresh = await harness.api('/api/paas-v2/catalog/modules/refresh', { body: { softwareUnique } });
        assert.equal(refresh.status, 200, refresh.text);
        assert.equal(sourceReads, 1);
        const url = `/api/paas-v2/catalog?softwareUnique=${softwareUnique}`;
        const full = await harness.api(url);
        assert.equal(full.status, 200, full.text);
        assert.equal(full.data.source, 'remote');
        assert.equal(sourceReads, 2);
        assert.deepEqual(full.data.tasks.map(task => task.plugFlag).sort(), ['grouped', 'ungrouped']);
        const cached = await harness.api(url);
        assert.equal(cached.status, 200, cached.text);
        assert.equal(cached.data.source, 'database');
        assert.deepEqual(cached.data.tasks, full.data.tasks);
        assert.equal(sourceReads, 2);
    } finally { await harness.dispose(); }
});

test('catalog module refresh backfills registered platforms without replacing cards or cover data', async () => {
    const harness = await createProductionHarness({ bindings: { DAYU_COVER_USERNAME: 'fixture-user', DAYU_COVER_PASSWORD: 'fixture-password' } });
    try {
        const requests = [];
        const noModules = new Set();
        const failures = new Set();
        const groups = new Map([['scyxcjrh', '官方模块一'], ['dzswcjrh', '官方模块二']]);
        harness.platform.fetch = async request => {
            assert.equal(new URL(request.url).hostname, 'paas.itmc.org.cn');
            const softwareUnique = new URLSearchParams(await request.text()).get('token');
            requests.push(softwareUnique);
            assert.ok(groups.has(softwareUnique), 'only registered platforms should be requested');
            if (failures.has(softwareUnique)) return new Response('', { status: 503 });
            const moduleTitle = groups.get(softwareUnique);
            return Response.json({ code: 0, data: noModules.has(softwareUnique) ? { taskJson: [] } : {
                taskModuleJson: [{ id: 21, moduleTitle, moduleOrder: 4 }],
                taskJson: [
                    { plugId: 'match', taskTitle: '供应商任务名', taskModuleId: 21, taskOrder: 2 },
                    { plugId: 'new', taskTitle: '新增任务', taskModuleId: 21, taskOrder: 3 }
                ]
            } });
        };
        const [stored] = await harness.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'scyxcjrh'");
        const original = [
            { plugFlag: 'MATCH', title: '保留的目录名称', introduce: '保留的简介', cover: '/api/paas-v2/covers/fixture.png' },
            { plugFlag: 'legacy', title: '仅存在于历史目录', moduleTitle: '已有分类', moduleId: '9', cover: 'legacy.png' }
        ];
        await harness.run('INSERT INTO paas_v2_catalogs (platform_id, tasks_json) VALUES (?, ?)', stored.id, JSON.stringify(original));
        for (const softwareUnique of groups.keys()) {
            await harness.run(`INSERT INTO competitions (title, url, sso_method, paas_v2_software_unique, paas_v2_plug_flag)
                VALUES ('本地卡片名称', 'https://training.example.invalid/enter', 'paasV2', ?, 'MATCH')`, softwareUnique);
        }
        const readCatalog = async () => {
            const [catalog] = await harness.rows('SELECT tasks_json FROM paas_v2_catalogs WHERE platform_id = ?', stored.id);
            return JSON.parse(catalog.tasks_json);
        };
        const cardRows = await harness.rows('SELECT * FROM competitions');
        const refresh = (softwareUnique, headers) => harness.api('/api/paas-v2/catalog/modules/refresh', {
            body: { softwareUnique }, headers
        });

        const user = { id: 90, role: 'student', username: 'fixture-student' };
        await harness.seedUser(user);
        assert.equal((await refresh('scyxcjrh', { Authorization: `Bearer ${await harness.issueToken(user)}` })).status, 403);
        assert.equal((await refresh('unregistered-fixture')).status, 404);
        assert.deepEqual(requests, []);

        const result = await refresh('SCYXCJRH');
        assert.equal(result.status, 200, result.text);
        assert.deepEqual(result.data, {
            softwareUnique: 'scyxcjrh', updated: 2, classified: 3, total: 3, sourceClassified: 2, cardTotal: 1, classifiedCards: 1, missingCards: 0
        });
        const catalog = await readCatalog();
        assert.deepEqual(catalog[0], { ...original[0], moduleTitle: '官方模块一', moduleId: '21', moduleOrder: 4, taskOrder: 2 });
        assert.deepEqual(catalog[1], original[1]);
        assert.equal(catalog[2].plugFlag, 'new');
        assert.equal((await refresh('scyxcjrh')).data.updated, 0);

        const another = await refresh('dzswcjrh');
        assert.equal(another.status, 200, another.text);
        assert.equal(another.data.classifiedCards, 1);
        const visible = await harness.api('/api/competitions');
        assert.equal(visible.status, 200, visible.text);
        assert.deepEqual(new Map(visible.data.map(card => [card.paasV2SoftwareUnique, card.agentModule?.title])), groups);
        assert.deepEqual(await harness.rows('SELECT * FROM competitions'), cardRows);

        noModules.add('scyxcjrh');
        const empty = await refresh('scyxcjrh');
        assert.equal(empty.status, 200, empty.text);
        assert.equal(empty.data.sourceClassified, 0);
        assert.equal(empty.data.updated, 0);
        assert.deepEqual(await readCatalog(), catalog);
        failures.add('scyxcjrh');
        assert.equal((await refresh('scyxcjrh')).status, 502);
        assert.deepEqual(await readCatalog(), catalog);
    } finally {
        await harness.dispose();
    }
});
