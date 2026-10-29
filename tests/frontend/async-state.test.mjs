import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { testBrowserOptions } from '../helpers/browser.mjs';

let server;
let browser;
let origin;

before(async () => {
    const apiStub = `
        const request = (method, url, body) => window.__testApi(method, url, body, localStorage.getItem('authToken'));
        export const api = { get: url => request('GET',url), post: (url,body) => request('POST',url,body),
            patch: (url,body) => request('PATCH',url,body), put: (url,body) => request('PUT',url,body),
            delete: url => request('DELETE',url), blob: url => request('GET',url), stream: url => request('POST',url) };
        export const onUnauthorized = listener => { window.addEventListener('fixture-unauthorized', listener); return () => window.removeEventListener('fixture-unauthorized', listener); };
        export const apiFetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    `;
    const feedbackStub = `export const feedbackEvents={notify:'fixture-notify',confirm:'fixture-confirm'}; export const notify=(message,type)=>window.__notifications.push({message,type}); export const confirmAction=async()=>true;`;
    const result = await build({
        entryPoints: [path.resolve('tests/frontend/fixtures/async-state-harness.jsx')],
        bundle: true, format: 'esm', write: false, logLevel: 'silent',
        plugins: [{ name: 'fixture-transport', setup(builder) {
            builder.onResolve({ filter: /\/utils\/(api|uiFeedback)(\.js)?$/ }, args => ({ path: args.path.includes('uiFeedback') ? 'feedback' : 'api', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'api' ? apiStub : feedbackStub }));
        } }]
    });
    const bundle = result.outputFiles[0].text;
    server = http.createServer((request, response) => {
        response.setHeader('Content-Type', request.url.startsWith('/fixture.js') ? 'text/javascript' : 'text/html');
        response.end(request.url.startsWith('/fixture.js') ? bundle : '<!doctype html><html><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch(testBrowserOptions());
});

after(async () => {
    await browser?.close();
    await new Promise(resolve => server?.close(resolve));
});

test('avatar commit stays successful when synchronization fails, and retry does not write again', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=profile&rejectRefresh=1`);
        await page.getByRole('button', { name: '移除', exact: true }).click();
        await page.getByRole('button', { name: '保存资料', exact: true }).click();
        await page.getByText('更改已保存，但账号信息同步失败，请重试刷新。', { exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__notifications), [{ message: '个人资料已保存', type: 'success' }]);
        await page.evaluate(() => { window.__failRefresh = false; });
        await page.getByRole('button', { name: '重试刷新', exact: true }).click();
        await page.getByText('PROFILE CLOSED', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.method === 'PATCH').length), 1);
    } finally { await page.close(); }
});

test('password commit is not reported as failed after a synchronization error', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=profile&rejectRefresh=1`);
        await page.getByLabel('当前密码', { exact: true }).fill('Old-Password-2026');
        await page.getByLabel('新密码', { exact: true }).fill('New-Password-2026');
        await page.getByLabel('确认新密码', { exact: true }).fill('New-Password-2026');
        await page.getByRole('button', { name: '更新密码', exact: true }).click();
        await page.getByText('登录密码已更新', { exact: true }).waitFor();
        await page.getByText('更改已保存，但账号信息同步失败，请重试刷新。', { exact: true }).waitFor();
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal(await page.getByLabel('当前密码', { exact: true }).inputValue(), '');
        await page.evaluate(() => { window.__failRefresh = false; });
        await page.getByRole('button', { name: '重试刷新', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url === '/auth/change-password').length), 1);
    } finally { await page.close(); }
});

test('a delayed platform deletion blocks import, dismissal and duplicate mutation', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=platform`);
        await page.getByRole('button', { name: '全选未导入', exact: true }).click();
        await page.getByRole('button', { name: '管理软件平台 Fixture platform', exact: true }).click();
        await page.getByRole('button', { name: '删除 Fixture platform', exact: true }).click();
        await page.waitForFunction(() => typeof window.__releaseDelete === 'function');
        assert.equal(await page.getByRole('button', { name: '导入所选任务', exact: true }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: '关闭智能体任务窗口', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape');
        await page.locator('.mc-modal-backdrop').dispatchEvent('mousedown');
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.method === 'DELETE').length), 1);
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url === '/competitions/batch-paas-v2').length), 0);
        await page.evaluate(() => window.__releaseDelete({ success: true }));
        await page.waitForFunction(() => !document.querySelector('[aria-label="关闭智能体任务窗口"]').disabled);
    } finally { await page.close(); }
});

test('500 task covers are cached sequentially in batches of 100 and a rejected batch does not stop the import', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=platform&largeCatalog=1`);
        await page.getByRole('button', { name: '全选未导入', exact: true }).click();
        await page.getByRole('button', { name: '导入所选任务', exact: true }).click();
        await page.getByText('TASK CLOSED', { exact: true }).waitFor();
        const result = await page.evaluate(() => ({
            covers: window.__calls.filter(call => call.url === '/paas-v2/covers/cache').map(call => call.body.urls.length),
            tasks: window.__calls.find(call => call.url === '/competitions/batch-paas-v2').body.tasks,
            maxCoverRequests: window.__maxCoverRequests,
            notifications: window.__notifications
        }));
        assert.deepEqual(result.covers, [100, 100, 100, 100, 100]);
        assert.equal(result.maxCoverRequests, 1);
        assert.equal(result.tasks.length, 500);
        assert.equal(result.tasks[0].paasV2Cover, '/cached/0.png');
        assert.equal(result.tasks[100].paasV2Cover, 'https://covers.example/100.png');
        assert.equal(result.tasks[200].paasV2Cover, '/cached/200.png');
        assert.equal(result.tasks[499].paasV2Cover, '/cached/499.png');
        assert.deepEqual(result.notifications, [{ message: '已导入 500 个智能体任务（部分封面未缓存）', type: 'warning' }]);
    } finally { await page.close(); }
});

test('SSO settings arriving after the task modal opens preserve selected tasks and the loaded catalog', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=platform&lateSso=1`);
        await page.getByRole('button', { name: '全选未导入', exact: true }).click();
        const before = await page.evaluate(() => window.__calls.filter(call => call.url.startsWith('/paas-v2/catalog')).length);
        await page.evaluate(() => window.__setSsoConfigs([{ configData: { method: 'paasV2', jumpBaseUrl: 'https://fixture.example/jump', productModuleId: 'different-platform' } }]));
        await page.waitForFunction(() => window.__renderedSsoConfigCount === 1);
        await page.getByRole('button', { name: '清空选择', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '导入所选任务', exact: true }).isDisabled(), false);
        await page.getByRole('button', { name: '导入所选任务', exact: true }).click();
        await page.getByText('TASK CLOSED', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url.startsWith('/paas-v2/catalog')).length), before);
        assert.equal(await page.evaluate(() => window.__calls.find(call => call.url === '/competitions/batch-paas-v2').body.tasks[0].url), 'https://fixture.example/jump');
    } finally { await page.close(); }
});

test('applying a returned profile does not restart application bootstrap or fetch protected SSO settings', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=app`);
        await page.getByRole('button', { name: '打开个人资料', exact: true }).waitFor();
        await page.waitForFunction(() => window.__calls.some(call => call.url.startsWith('/content/updates')));
        const before = await page.evaluate(() => window.__calls.map(call => call.url));
        await page.getByRole('button', { name: '打开个人资料', exact: true }).click();
        await page.getByRole('button', { name: '移除', exact: true }).click();
        await page.getByRole('button', { name: '保存资料', exact: true }).click();
        await page.getByRole('dialog', { name: '个人资料', exact: true }).waitFor({ state: 'detached' });
        const after = await page.evaluate(() => window.__calls.map(call => call.url));
        for (const url of ['/config/site', '/competitions', '/sso/student-accounts', '/ai/config', '/auth/me']) {
            assert.equal(after.filter(item => item === url).length, before.filter(item => item === url).length, `${url} should not reload for an avatar change`);
        }
        assert.equal(after.filter(url => url === '/sso-config').length, 0);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('authUser')).avatarDataUrl), null);
    } finally { await page.close(); }
});

test('a delayed 401 for the previous account cannot log out the replacement session', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=auth&deferAuth=1`);
        await page.waitForFunction(() => typeof window.__releaseAuth === 'function');
        await page.evaluate(() => {
            window.__session.handleLoginSuccess({ id: 8, username: 'replacement-user', role: 'student' }, 'replacement-token', { animate: false });
        });
        await page.getByText('replacement-user', { exact: true }).waitFor();
        await page.evaluate(() => window.__releaseAuth());
        await page.waitForFunction(() => window.__oldAuthRejected === true);
        assert.equal(await page.getByTestId('session-user').textContent(), 'replacement-user');
        assert.equal(await page.evaluate(() => localStorage.getItem('authToken')), 'replacement-token');
        assert.deepEqual(await page.evaluate(() => window.__notifications), []);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-unauthorized', { detail: { token: null } })));
        assert.equal(await page.getByTestId('session-user').textContent(), 'replacement-user');
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-unauthorized', { detail: { token: 'replacement-token' } })));
        await page.getByText('anonymous', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('authToken')), null);
    } finally { await page.close(); }
});
