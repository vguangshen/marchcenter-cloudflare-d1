import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let noSecrets;
let configured;
let mode = 'success';
const calls = [];
const fakeUsername = 'cover-fixture-user';
const fakePassword = 'cover-fixture-password';
const catalog = { code: 0, data: {
    taskModuleJson: [
        { id: '9007199254740993', moduleTitle: '市场分析', moduleOrder: 2 },
        { id: '9007199254740992', moduleTitle: '供应链数据分析', moduleOrder: 0 }
    ],
    taskJson: [{ plugId: 'task-1', taskTitle: '测试任务', taskModuleId: '9007199254740993', taskOrder: 3 }],
    plugMngJson: [{ plugFlag: 'task-1', plugName: '测试插件' }],
    taskEnterInfoJson: [{ plugFlag: 'task-1', answerType: '2,4', trainJumpPath: 'https://training.example.invalid/enter' }]
} };
const json = value => Response.json(value);

async function mockFetch(request) {
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.hostname === 'paas.itmc.org.cn') return new Response(JSON.stringify(catalog).replaceAll(/"(900719925474099[23])"/g, '$1'));
    assert.equal(url.hostname, 'dayu.itmc.org.cn', 'all upstream requests stay inside the fixture');
    if (url.pathname.endsWith('/auth/login')) {
        assert.deepEqual(await request.json(), { username: fakeUsername, password: fakePassword });
        if (mode === 'login-error') return new Response('Unavailable', { status: 503 });
        if (mode === 'login-redirect') return new Response('', { status: 302, headers: { Location: 'https://other.example.invalid/collect' } });
        if (mode === 'login-json') return new Response('{broken');
        if (mode === 'no-token') return json({ data: {} });
        if (mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 600));
        return json({ data: { access_token: 'fixture-access-token' } });
    }
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-access-token');
    if (mode === 'hot-error') return new Response('Unavailable', { status: 503 });
    if (mode === 'hot-json') return new Response('{broken');
    if (mode === 'hot-shape') return json({ data: { content: {} } });
    return json({ data: { content: [{ id: 'task-1', name: '测试插件', cover: 'https://images.example.invalid/task.png', introduce: '任务介绍' }] } });
}

before(async () => {
    noSecrets = await createProductionHarness({ bindings: { DAYU_COVER_USERNAME: '', DAYU_COVER_PASSWORD: '' } });
    noSecrets.platform.fetch = mockFetch;
    configured = await createProductionHarness({ bindings: {
        DAYU_COVER_USERNAME: fakeUsername, DAYU_COVER_PASSWORD: fakePassword, DAYU_COVER_TIMEOUT_MS: '250'
    } });
    configured.platform.fetch = mockFetch;
});
after(async () => { await configured?.dispose(); await noSecrets?.dispose(); });

async function refresh(harness) {
    calls.length = 0;
    const result = await harness.api('/api/paas-v2/catalog?softwareUnique=scyxcjrh&force=1');
    assert.equal(result.status, 200, result.text);
    assert.equal(result.data.source, 'remote');
    assert.equal(result.data.tasks[0].plugFlag, 'task-1');
    assert.equal(result.data.tasks[0].answerType, '1');
    assert.equal(result.text.includes(fakePassword), false);
    assert.equal(result.text.includes('fixture-access-token'), false);
    return result;
}

test('unconfigured optional cover credentials never cause a login and task catalogs still persist', async () => {
    const result = await refresh(noSecrets);
    assert.equal(result.data.tasks[0].cover, '');
    assert.deepEqual(calls, ['/paascode/synchronize/getSoftwareInfoToJson']);
    const saved = await noSecrets.api('/api/paas-v2/catalog?softwareUnique=scyxcjrh');
    assert.equal(saved.data.source, 'database');
    assert.deepEqual(saved.data.tasks, result.data.tasks);
});

test('refreshing the catalog groups already imported tasks by platform and exposes only visible cards', async () => {
    const seedTask = async (softwareUnique, flag) => (await noSecrets.run(
        "INSERT INTO competitions (title, url, sso_method, paas_v2_software_unique, paas_v2_plug_flag) VALUES ('已改名任务', 'https://training.example.invalid/enter', 'paasV2', ?, ?)",
        softwareUnique, flag
    )).meta.last_row_id;
    const taskId = await seedTask('SCYXCJRH', 'TASK-1');
    const unrelatedTaskId = await seedTask('dzswcjrh', 'task-1');
    const hiddenTaskId = await seedTask('scyxcjrh', 'task-1');
    const [platform] = await noSecrets.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'scyxcjrh'");
    await noSecrets.run('UPDATE paas_v2_catalogs SET tasks_json = ? WHERE platform_id = ?', JSON.stringify([
        { plugFlag: 'task-1', moduleId: '9007199254740993' }
    ]), platform.id);

    const user = { id: 99, username: 'agent-module-student', role: 'student' };
    await noSecrets.seedUser(user);
    await noSecrets.run('INSERT INTO user_access_policies (user_id, configured) VALUES (?, 1)', user.id);
    await noSecrets.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?), (?, ?)', user.id, taskId, user.id, unrelatedTaskId);
    const headers = { Authorization: `Bearer ${await noSecrets.issueToken(user)}` };
    const before = await noSecrets.api('/api/competitions', { headers });
    assert.equal(before.status, 200, before.text);
    assert.equal(before.data.find(card => card.id === taskId).agentModule, null);

    await refresh(noSecrets);
    const after = await noSecrets.api('/api/competitions', { headers });
    assert.equal(after.status, 200, after.text);
    assert.deepEqual(after.data.find(card => card.id === taskId).agentModule, {
        id: '9007199254740993', title: '市场分析', order: 2, taskOrder: 3
    });
    assert.equal(after.data.find(card => card.id === unrelatedTaskId).agentModule, null);
    assert.ok(!after.data.some(card => card.id === hiddenTaskId));
});

test('verified sjfxah groups cover legacy cards and yield to catalog metadata', async () => {
    const platform = await noSecrets.api('/api/paas-v2/platforms', { body: { softwareUnique: 'sjfxah', code: 'sjfxah', name: '数据分析方法与工具应用' } });
    assert.equal(platform.status, 201, platform.text);
    const cards = [
        ['market', '市场趋势分析'], ['offline', '行业数据分析'], ['peer', '市场洞察智能体'],
        ['supply', '采购数据分析'], ['marketing', '营销渠道分析'], ['conflict', '待分类任务'],
        ['sales-a', '销售趋势分析'], ['sales-b', '订单数据分析'],
        ['customer-a', '客户数据分析智能体搭建'], ['customer-b', '客户数据分析智能体搭建'],
        ['customer-c', '客户数据分析智能体搭建'], ['finance-a', '经营成本分析'], ['finance-b', '现金流量分析']
    ];
    for (const [flag, title] of cards) {
        await noSecrets.run("INSERT INTO competitions (title, url, sso_method, paas_v2_software_unique, paas_v2_plug_flag) VALUES (?, 'https://training.example.invalid/enter', 'paasV2', 'sjfxah', ?)", title, flag);
    }
    const list = async () => {
        const response = await noSecrets.api('/api/competitions');
        assert.equal(response.status, 200, response.text);
        return new Map(response.data.map(card => [card.paasV2PlugFlag, card.agentModule]));
    };
    const offline = await list();
    assert.equal(offline.get('market').title, '市场分析');
    assert.equal(offline.get('market').id, offline.get('offline').id);
    assert.equal(offline.get('supply').title, '供应链数据分析');
    assert.equal(offline.get('marketing').title, '营销推广分析');
    assert.deepEqual(['sales-a', 'sales-b', 'customer-a', 'customer-b', 'customer-c', 'finance-a', 'finance-b']
        .map(flag => offline.get(flag).title), ['商品销售分析', '商品销售分析', '客户数据分析', '客户数据分析', '客户数据分析', '财务数据分析', '财务数据分析']);
    assert.equal(offline.get('customer-a').id, offline.get('customer-c').id);
    assert.equal(offline.get('peer'), null);

    const [platformRow] = await noSecrets.rows("SELECT id FROM paas_v2_platforms WHERE software_unique = 'sjfxah'");
    const legacyTasks = [
        { plugFlag: 'market', title: '市场趋势分析', moduleId: '101' },
        { plugFlag: 'peer', title: '市场洞察智能体', moduleId: '101' },
        { plugFlag: 'conflict-a', title: '采购数据分析', moduleId: '102' },
        { plugFlag: 'conflict-b', title: '营销渠道分析', moduleId: '102' },
        { plugFlag: 'conflict', title: '待分类任务', moduleId: '102' }
    ];
    await noSecrets.run('INSERT INTO paas_v2_catalogs (platform_id, tasks_json) VALUES (?, ?)', platformRow.id, JSON.stringify(legacyTasks));
    const legacy = await list();
    assert.deepEqual(legacy.get('market'), { id: '101', title: '市场分析', order: 1, taskOrder: 1 });
    assert.equal(legacy.get('offline').id, '101');
    assert.equal(legacy.get('peer').title, '市场分析');
    assert.equal(legacy.get('conflict'), null);

    legacyTasks[0] = { ...legacyTasks[0], moduleTitle: '最新市场分析', moduleOrder: 0, taskOrder: 0 };
    await noSecrets.run('UPDATE paas_v2_catalogs SET tasks_json = ? WHERE platform_id = ?', JSON.stringify(legacyTasks), platformRow.id);
    const current = await list();
    assert.deepEqual(current.get('market'), { id: '101', title: '最新市场分析', order: 0, taskOrder: 0 });
    assert.equal(current.get('peer').title, '最新市场分析');
    assert.equal(current.get('offline').title, '最新市场分析');
});

test('optional login, token and cover index failures cannot turn a healthy catalog into a failure', async () => {
    for (mode of ['login-error', 'login-redirect', 'login-json', 'no-token', 'hot-error', 'hot-json', 'hot-shape']) {
        const result = await refresh(configured);
        assert.equal(result.data.tasks[0].cover, '', mode);
        assert.equal(result.data.tasks[0].introduce, '', mode);
        assert.ok(calls.length <= 3, mode);
    }
});

test('providing only one credential never falls back to a source-defined account', async () => {
    for (const bindings of [
        { DAYU_COVER_USERNAME: fakeUsername, DAYU_COVER_PASSWORD: '' },
        { DAYU_COVER_USERNAME: '', DAYU_COVER_PASSWORD: fakePassword }
    ]) {
        const harness = await createProductionHarness({ bindings });
        try {
            harness.platform.fetch = mockFetch;
            const result = await refresh(harness);
            assert.equal(result.data.tasks[0].cover, '');
            assert.deepEqual(calls, ['/paascode/synchronize/getSoftwareInfoToJson']);
        } finally { await harness.dispose(); }
    }
});

test('the shared optional-service deadline cancels slow authentication without blocking the catalog', async () => {
    mode = 'timeout';
    const result = await refresh(configured);
    assert.equal(result.data.tasks[0].cover, '');
    assert.equal(calls.some(path => path.endsWith('/getHotIndex')), false);
});

test('configured runtime credentials still enrich valid tasks without returning or logging secrets', async () => {
    mode = 'success';
    const result = await refresh(configured);
    assert.equal(result.data.tasks[0].cover, 'https://images.example.invalid/task.png');
    assert.equal(result.data.tasks[0].introduce, '任务介绍');
    assert.equal(JSON.stringify(configured.logs).includes(fakePassword), false);
    const list = await configured.api('/api/paas-v2/platforms');
    assert.equal(list.data.find(platform => platform.softwareUnique === 'scyxcjrh').catalogTaskCount, 1);
});
