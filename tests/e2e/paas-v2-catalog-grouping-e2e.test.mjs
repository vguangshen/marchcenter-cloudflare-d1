import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('newly imported cards use the provider module and lossless plug identifiers on any platform', async () => {
    const harness = await createProductionHarness({ bindings: { DAYU_COVER_USERNAME: '', DAYU_COVER_PASSWORD: '' } });
    try {
        const softwareUnique = 'new-module-platform';
        const firstFlag = '9007199254740995';
        const secondFlag = '9007199254740996';
        const firstModuleId = '9007199254740992';
        const secondModuleId = '9007199254740993';
        const jump = 'https://training.example.invalid/enter';
        await harness.seedConfig({ method: 'paasV2', jumpBaseUrl: jump });
        const platform = await harness.api('/api/paas-v2/platforms', { body: {
            softwareUnique, code: 'NEW', name: '任意新平台'
        } });
        assert.equal(platform.status, 201, platform.text);
        let data = {
            taskModuleJson: [
                { id: firstModuleId, moduleTitle: '服务端模块一', moduleOrder: 0 },
                { id: secondModuleId, moduleTitle: '服务端模块二', moduleOrder: 1 },
                null
            ],
            taskJson: [
                { plugId: 'older-alias', plugIdBak: firstFlag, taskTitle: '重复任务标题', taskModuleId: firstModuleId, taskOrder: 0 },
                { plugId: secondFlag, taskTitle: '重复任务标题', taskModuleId: 'retired-module' },
                null,
                { taskTitle: '无任务标识' }
            ],
            plugMngJson: [
                { plugFlag: firstFlag, taskModuleId: firstModuleId },
                { plugFlag: secondFlag, taskModuleId: secondModuleId, plugOrder: 2 },
                { plugFlag: ' trim-Flag ', plugName: '仅插件目录里的任务', taskModuleId: secondModuleId, plugOrder: 3 }
            ],
            taskEnterInfoJson: [firstFlag, secondFlag, 'TRIM-FLAG'].map(plugFlag => ({ plugFlag, trainJumpPath: jump }))
        };
        harness.platform.fetch = async request => {
            assert.equal(new URL(request.url).hostname, 'paas.itmc.org.cn');
            assert.equal(new URLSearchParams(await request.text()).get('token'), softwareUnique);
            return new Response(JSON.stringify({ code: 0, data }).replaceAll(/"(900719925474099[2356])"/g, '$1'));
        };
        const refresh = () => harness.api(`/api/paas-v2/catalog?softwareUnique=${softwareUnique}&force=1`);
        const catalog = await refresh();
        assert.equal(catalog.status, 200, catalog.text);
        assert.equal(catalog.data.source, 'remote');
        assert.equal(catalog.data.tasks.length, 3);
        const imported = await harness.api('/api/competitions/batch-paas-v2', { body: {
            tasks: catalog.data.tasks.map(task => ({
                title: '本地改名',
                url: task.trainJumpPath,
                paasV2PlugFlag: task.plugFlag,
                paasV2SoftwareUnique: softwareUnique
            }))
        } });
        assert.equal(imported.status, 200, imported.text);
        assert.equal(imported.data.created, 3);
        const cards = await harness.api('/api/competitions');
        assert.equal(cards.status, 200, cards.text);
        const modules = new Map(cards.data.map(card => [card.paasV2PlugFlag, card.agentModule]));
        assert.deepEqual(modules.get(firstFlag), { id: firstModuleId, title: '服务端模块一', order: 0, taskOrder: 0 });
        assert.deepEqual(modules.get(secondFlag), { id: secondModuleId, title: '服务端模块二', order: 1, taskOrder: 2 });
        assert.deepEqual(modules.get('TRIM-FLAG'), { id: secondModuleId, title: '服务端模块二', order: 1, taskOrder: 3 });

        const originalData = data;
        data = { taskModuleJson: [] };
        const fallback = await refresh();
        assert.equal(fallback.status, 200, fallback.text);
        assert.equal(fallback.data.source, 'database-fallback');
        assert.deepEqual(fallback.data.tasks, catalog.data.tasks);

        data = { ...originalData, taskJson: [originalData.taskJson[0]], plugMngJson: [originalData.plugMngJson[0]],
            taskEnterInfoJson: [originalData.taskEnterInfoJson[0]] };
        const partial = await refresh();
        assert.equal(partial.status, 200, partial.text);
        assert.equal(partial.data.tasks.length, 1);
        assert.equal(partial.data.missingTaskCount, 2);
        const cached = await harness.api(`/api/paas-v2/catalog?softwareUnique=${softwareUnique}`);
        assert.equal(cached.data.missingTaskCount, 2);
        assert.deepEqual(cached.data.tasks, partial.data.tasks);
        const refreshedCards = await harness.api('/api/competitions');
        assert.deepEqual(refreshedCards.data.find(card => card.paasV2PlugFlag === secondFlag).agentModule, modules.get(secondFlag));
        const platforms = await harness.api('/api/paas-v2/platforms');
        const platformEntry = platforms.data.find(item => item.softwareUnique === softwareUnique);
        assert.equal(platformEntry.catalogTaskCount, 1);
        assert.equal(platformEntry.catalogSyncStatus, 'ok');

        data = { ...originalData, taskModuleJson: [originalData.taskModuleJson[0], { ...originalData.taskModuleJson[1], moduleTitle: '新模块名' }] };
        const recovered = await refresh();
        assert.equal(recovered.data.missingTaskCount, 0);
        assert.equal(recovered.data.tasks.length, 3);
        const regrouped = await harness.api('/api/competitions');
        assert.equal(regrouped.data.find(card => card.paasV2PlugFlag === secondFlag).agentModule.title, '新模块名');
    } finally {
        await harness.dispose();
    }
});
