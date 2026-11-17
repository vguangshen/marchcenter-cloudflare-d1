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
    taskJson: [{ plugId: 'task-1', taskTitle: '测试任务' }],
    plugMngJson: [{ plugFlag: 'task-1', plugName: '测试插件' }],
    taskEnterInfoJson: [{ plugFlag: 'task-1', answerType: '2,4', trainJumpPath: 'https://training.example.invalid/enter' }]
} };
const json = value => Response.json(value);

async function mockFetch(request) {
    const url = new URL(request.url);
    calls.push(url.pathname);
    if (url.hostname === 'paas.itmc.org.cn') return json(catalog);
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
