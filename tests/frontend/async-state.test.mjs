import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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
            delete: url => request('DELETE',url), blob: url => request('GET',url),
            stream: (url, options) => request('POST', url, options?.body ? JSON.parse(options.body) : undefined) };
        export const onUnauthorized = listener => { window.addEventListener('fixture-unauthorized', listener); return () => window.removeEventListener('fixture-unauthorized', listener); };
        export const apiFetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        export const changePassword = async body => {
            const previous = localStorage.getItem('authToken');
            const data = await request('POST', '/auth/change-password', body);
            if (previous && data?.token) window.dispatchEvent(new CustomEvent('fixture-token-rotated', { detail: { previous, token: data.token } }));
            return data;
        };
        export const bindMyEmail = async email => (await request('PATCH', '/users/me/email', { email }))?.user;
        export const onTokenRotated = listener => { window.addEventListener('fixture-token-rotated', listener); return () => window.removeEventListener('fixture-token-rotated', listener); };
        export const revokeSession = async token => { (window.__revokedSessions ||= []).push(token); };
    `;
    const feedbackStub = `export const feedbackEvents={notify:'fixture-notify',confirm:'fixture-confirm'}; export const notify=(message,type)=>window.__notifications.push({message,type}); export const confirmAction=async()=>true;`;
    const result = await build({
        entryPoints: [path.resolve('tests/frontend/fixtures/async-state-harness.jsx')],
        bundle: true, format: 'esm', write: false, logLevel: 'silent',
        plugins: [{ name: 'vite-raw', setup(builder) {
            // Mirror Vite's `?raw` imports (the layered default scene SVGs).
            builder.onResolve({ filter: /\?raw$/ }, args => ({
                path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw'
            }));
            builder.onLoad({ filter: /.*/, namespace: 'raw' }, async args => ({
                contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))};`, loader: 'js'
            }));
        } }, { name: 'fixture-transport', setup(builder) {
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

test('refreshing page two of a teacher’s students keeps the open action panel and reconciles transfers', async () => {
    const page = await browser.newPage();
    try {
        // Installed before the first render so the background prefetch of the
        // teacher's students is served (and counted) by this transport too.
        await page.addInitScript(() => {
            let requests = 0;
            window.__testApiOverride = async (_method, path) => {
                const pageNumber = Number(new URL(path, location.origin).searchParams.get('page'));
                const refreshing = ++requests > 2;
                if (refreshing && pageNumber === 2) await new Promise(resolve => { window.__releaseStudents = resolve; });
                let ids = Array.from({ length: 52 }, (_, i) => i + 1);
                if (refreshing) ids = ids.filter(id => id !== 9);
                const users = ids.slice((pageNumber - 1) * 50, pageNumber * 50).map(id => ({
                    id, username: `Student-${id}`, role: 'student', is_disabled: id === 52 && refreshing
                }));
                return { users, totalPages: 2 };
            };
        });
        await page.goto(`${origin}/?mode=user-directory`);
        await page.getByRole('button', { name: /^展开 Teacher 的学生/ }).click();
        await page.getByRole('button', { name: '加载更多学生' }).click();
        await page.getByRole('button', { name: '管理 Student-52', exact: true }).click();
        const panel = page.getByRole('group', { name: 'Student-52 的管理操作' });
        await panel.getByRole('button', { name: '禁用用户' }).click();
        await page.waitForFunction(() => typeof window.__releaseStudents === 'function');
        assert.ok(await panel.isVisible());
        await page.evaluate(() => window.__releaseStudents());
        await panel.getByRole('button', { name: '启用用户' }).waitFor();
        assert.equal(await page.getByRole('button', { name: '管理 Student-9', exact: true }).count(), 0);
        assert.equal(await page.getByRole('list', { name: 'Teacher 的学生' }).getByRole('listitem').count(), 51);
    } finally { await page.close(); }
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

test('agent task starts unstarted, shows score actions after entering, and restores initial actions after reset', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=agent-score`);
        const enter = page.getByRole('button', { name: '进入智能体任务', exact: true });
        const query = page.getByRole('button', { name: '查询得分', exact: true });
        await page.getByText('未开始', { exact: true }).waitFor();
        assert.equal(await query.count(), 0);
        await enter.click();
        await page.getByText('未查分', { exact: true }).waitFor();
        await page.getByRole('button', { name: '继续智能体任务', exact: true }).waitFor();
        assert.equal(await query.isEnabled(), true);
        assert.equal(await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
            return window.__calls.some(call => call.url === '/paas-v2/result');
        }), false);
        assert.equal(await page.getByRole('button', { name: '得分详情', exact: true }).count(), 0);

        await page.evaluate(() => { window.__agentResult = { status: 'scoring', score: null }; });
        await query.click();
        await page.getByText('评分中', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '得分详情', exact: true }).count(), 0);

        await page.evaluate(() => { window.__agentResult = { status: 'completed', score: 0 }; });
        await page.getByRole('button', { name: '刷新得分', exact: true }).click();
        const scoreDetails = page.getByRole('button', { name: '得分详情', exact: true });
        await scoreDetails.waitFor();
        assert.match(await page.getByRole('status').textContent(), /0\s*分/);
        assert.equal(await page.getByRole('button', { name: '继续智能体任务', exact: true }).count(), 0);
        await scoreDetails.click();
        await page.waitForFunction(() => window.__agentPopups.filter(popup => popup.url).length === 2);
        assert.deepEqual(await page.evaluate(() => window.__calls.filter(call => call.action === 'open-agent')), [
            { action: 'open-agent', cardId: 42, role: 'student', target: null, options: undefined },
            { action: 'open-agent', cardId: 42, role: 'student', target: null, options: { scoreDetails: true } }
        ]);
        const launchCalls = await page.evaluate(() => window.__calls.filter(call => call.url === '/sso/execute/stream'));
        assert.equal(launchCalls.length, 2);
        assert.deepEqual(launchCalls[1].body, launchCalls[0].body);

        await page.evaluate(() => { window.__agentResult = { status: 'completed', score: null }; });
        await page.getByRole('button', { name: '刷新得分', exact: true }).click();
        await page.getByText('暂无得分', { exact: true }).waitFor();
        assert.equal(await scoreDetails.isEnabled(), true);

        await page.evaluate(() => { window.__agentResult = { status: 'in_progress', score: null }; });
        await scoreDetails.click();
        await page.getByRole('button', { name: '继续智能体任务', exact: true }).waitFor();
        await page.waitForFunction(() => window.__agentPopups.length === 3 && window.__agentPopups[2].closed);
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url === '/sso/execute/stream').length), 2);

        await page.getByRole('button', { name: '重置任务', exact: true }).click();
        await enter.waitFor();
        await page.getByText('未开始', { exact: true }).waitFor();
        assert.equal(await scoreDetails.count(), 0);
        assert.equal(await query.count(), 0);
    } finally { await page.close(); }
});

test('a stale progress cache and failed launch or reset preserve the appropriate score actions', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=agent-score&legacyProgress=1`);
        const enter = page.getByRole('button', { name: '进入智能体任务', exact: true });
        const query = page.getByRole('button', { name: '查询得分', exact: true });
        await page.evaluate(() => { window.__failAgentLaunch = true; });
        await enter.click();
        await page.waitForFunction(() => window.__agentPopups[0]?.closed);
        await page.getByText('未开始', { exact: true }).waitFor();
        assert.equal(await query.count(), 0);

        await page.evaluate(() => { window.__failAgentLaunch = false; });
        await enter.click();
        await page.getByText('未查分', { exact: true }).waitFor();
        await page.evaluate(() => { window.__agentResult = { status: 'scoring', score: null }; });
        await page.getByRole('button', { name: '继续智能体任务', exact: true }).click();
        await page.waitForFunction(() => window.__agentPopups[2]?.url);
        await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
        await page.getByText('评分中', { exact: true }).waitFor();
        await page.evaluate(() => {
            window.__agentResult = { status: 'completed', score: 88 };
            window.__failAgentReset = true;
        });
        await page.getByRole('button', { name: '刷新得分', exact: true }).click();
        const scoreDetails = page.getByRole('button', { name: '得分详情', exact: true });
        await scoreDetails.waitFor();
        await page.getByRole('button', { name: '重置任务', exact: true }).click();
        await page.waitForFunction(() => window.__notifications.some(notification => notification.message === 'Fixture reset failed'));
        assert.equal(await scoreDetails.isEnabled(), true);
        assert.match(await page.getByRole('status').textContent(), /88\s*分/);
        assert.equal(await enter.count(), 0);
    } finally { await page.close(); }
});

test('agent project filters are scoped to their platform and include unclassified cards', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=agent-modules`);
        const platforms = page.locator('section.agent-task-module');
        const analytics = platforms.filter({ has: page.getByRole('heading', { name: /数据分析方法与工具应用/ }) });
        const other = platforms.filter({ has: page.getByRole('heading', { name: /独立平台/ }) });
        const legacy = platforms.filter({ has: page.getByRole('heading', { name: /历史平台/ }) });
        const market = analytics.getByRole('button', { name: /^市场分析/ });
        await market.waitFor();
        await legacy.getByRole('heading', { name: '历史任务', exact: true }).waitFor();
        assert.match(await market.textContent(), /2\s*$/);
        assert.match(await analytics.getByRole('button', { name: /^全部/ }).textContent(), /4\s*$/);
        assert.deepEqual(await analytics.getByRole('heading', { level: 4 }).allTextContents(), [
            '市场分析', '供应链数据分析', '其他任务'
        ]);
        assert.deepEqual(await analytics.getByRole('article').getByRole('heading').allTextContents(), [
            '乙类指标解读', '甲类指标解读', '仓储任务', '补充练习'
        ]);
        assert.equal(await legacy.getByRole('button', { name: /^(全部|其他任务)/ }).count(), 0);
        assert.equal(await legacy.getByRole('article').count(), 1);

        await market.click();
        assert.equal(await market.getAttribute('aria-pressed'), 'true');
        assert.equal(await analytics.getByRole('article').count(), 2);
        assert.equal(await analytics.locator('article').count(), 2);
        assert.equal(await other.getByRole('article').count(), 2);
        assert.equal(await analytics.getByRole('button', { name: '得分详情', exact: true }).count(), 1);

        await analytics.getByRole('button', { name: /^其他任务/ }).click();
        assert.deepEqual(await analytics.getByRole('article').getByRole('heading').allTextContents(), ['补充练习']);

        const searchBox = page.getByPlaceholder('搜索竞赛或类目...').first();
        await searchBox.fill('供应链数据分析');
        await analytics.getByRole('heading', { name: '仓储任务', exact: true }).waitFor();
        assert.equal(await analytics.getByRole('article').count(), 1);
        assert.equal(await analytics.getByRole('heading', { name: '补充练习', exact: true }).count(), 0);
    } finally { await page.close(); }
});

const readMaintenanceCalls = page => page.evaluate(() => window.__calls.filter(call =>
    call.url === '/competitions' || call.url.startsWith('/sso') || call.method !== 'GET'
));

async function holdCardForMaintenance(page, title) {
    // The fixture does not load the styles that position the hold progress overlay.
    await page.mouse.move(0, 0);
    await title.dispatchEvent('pointerdown', {
        pointerType: 'mouse', pointerId: 99, button: 0, isPrimary: true
    });
    await page.getByRole('dialog', { name: '系统维护' }).waitFor({ timeout: 5000 });
}

test('maintenance requires a hold and shows disabled action help on touch', async () => {
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    try {
        await page.clock.install();
        await page.goto(`${origin}/?mode=maintenance`);
        const title = page.getByRole('heading', { name: 'Java 实训', exact: true });
        const dialog = page.getByRole('dialog', { name: '系统维护' });
        await title.waitFor();
        assert.equal(await page.getByRole('button', { name: /打开系统维护/ }).count(), 0);

        await title.tap();
        await page.clock.runFor(700);
        assert.equal(await dialog.count(), 0);

        const box = await title.boundingBox();
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
            type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
        });
        try {
            await page.clock.runFor(700);
            await dialog.waitFor();
        } finally {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        const info = dialog.getByRole('button', { name: '查看删除班级说明' });
        const disabled = dialog.getByRole('button', { name: '删除班级', exact: true });
        const cancel = dialog.getByRole('button', { name: '取消', exact: true });
        const tooltip = dialog.getByRole('tooltip').filter({ hasText: '班级删除映射未配置' });
        await info.waitFor();
        assert.equal(await disabled.isDisabled(), true);
        assert.equal(await tooltip.isVisible(), false);
        const before = await readMaintenanceCalls(page);
        await info.tap();
        await tooltip.waitFor();
        assert.deepEqual(await readMaintenanceCalls(page), before);

        await cancel.tap();
        await dialog.waitFor({ state: 'detached' });
        await page.clock.runFor(50);
        assert.equal(await title.evaluate(element => document.activeElement === element), false);

        await title.press('Enter');
        assert.equal(await dialog.count(), 0);
        await page.keyboard.down('Space');
        await page.clock.runFor(700);
        assert.equal(await dialog.count(), 0);
        await page.keyboard.up('Space');
        await dialog.waitFor();
        await cancel.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'Java 实训');
        assert.deepEqual(await readMaintenanceCalls(page), before);
    } finally { await page.close(); }
});

test('maintenance retry sends only the accounts that failed to sync', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        const title = page.locator('h3').filter({ hasText: /^已绑定实训$/ });
        const card = page.locator('.contest-card-shell').filter({ has: title });
        await holdCardForMaintenance(page, title);
        await card.getByRole('button', { name: '修复登录', exact: true }).click();
        await page.waitForFunction(() => window.__notifications.some(item => item.message.includes('1 个待重试')));
        const retry = card.getByRole('button', { name: '重试失败账号', exact: true });
        if (!await retry.isVisible()) await holdCardForMaintenance(page, title);
        await retry.click();
        await page.waitForFunction(() => window.__notifications.some(item => item.message.includes('账号同步完成')));
        assert.deepEqual(await page.evaluate(() => window.__calls.filter(call => call.url.endsWith('/repair')).map(call => call.body)), [
            {}, { targets: [{ loginRole: 'student', studentIndex: 1 }] }
        ]);
    } finally { await page.close(); }
});

test('long press shows maintenance states with explanations on hover and makes no additional request', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        await page.clock.install();
        await page.goto(`${origin}/?mode=maintenance`);
        const title = page.getByRole('heading', { name: 'Java 实训', exact: true });
        const readyTitle = page.getByRole('heading', { name: '已绑定实训', exact: true });
        const actionReasons = [
            ['删除班级', '班级删除映射未配置'],
            ['修复登录', '登录修复未绑定平台实例'],
            ['初始化系统', '系统初始化未绑定平台实例']
        ];
        const remove = page.getByRole('button', { name: '删除班级', exact: true });
        const cancel = page.getByRole('button', { name: '取消', exact: true });
        await title.waitFor();
        const beforePress = await readMaintenanceCalls(page);
        await title.click();
        await page.clock.runFor(700);
        assert.equal(await page.getByRole('dialog', { name: '系统维护' }).count(), 0);
        await holdCardForMaintenance(page, title);
        await remove.waitFor();
        const maintenanceHeading = page.getByText('系统维护', { exact: true });
        for (const [, reason] of actionReasons) {
            assert.equal(await page.getByText(reason, { exact: true }).isVisible(), false);
        }
        for (const [name, reason] of actionReasons) {
            const action = page.getByRole('button', { name, exact: true });
            const tooltip = page.getByRole('tooltip').filter({ hasText: reason });
            assert.equal(await action.isDisabled(), true);
            assert.match(await action.getAttribute('class'), /\bbg-slate-200\b/);
            assert.equal(await action.evaluate(button => document.getElementById(button.getAttribute('aria-describedby'))?.textContent), reason);
            await action.locator('..').hover();
            await tooltip.waitFor();
            assert.equal(await tooltip.textContent(), reason);
            assert.equal(await page.getByRole('tooltip').count(), 1);
            await maintenanceHeading.hover();
            await tooltip.waitFor({ state: 'hidden' });
            await action.evaluate(button => button.click());
        }
        const removeTrigger = remove.locator('..');
        const removeTooltip = page.getByRole('tooltip').filter({ hasText: actionReasons[0][1] });
        assert.equal(await removeTrigger.getAttribute('tabindex'), '0');
        await cancel.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await removeTrigger.evaluate(element => element === document.activeElement), true);
        await removeTooltip.waitFor();
        await page.keyboard.press('Escape');
        await removeTooltip.waitFor({ state: 'hidden' });
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await removeTooltip.waitFor();
        await page.keyboard.press('Tab');
        await removeTooltip.waitFor({ state: 'hidden' });
        assert.deepEqual(await readMaintenanceCalls(page), beforePress);
        assert.deepEqual(await page.evaluate(() => window.__notifications), []);

        await cancel.click();
        await remove.waitFor({ state: 'detached' });
        await page.clock.runFor(50);
        assert.equal(await title.evaluate(element => document.activeElement === element), false);
        await holdCardForMaintenance(page, readyTitle);
        await remove.waitFor();
        for (const [name, reason] of actionReasons) {
            assert.equal(await page.getByRole('button', { name, exact: true }).isEnabled(), true);
            assert.equal(await page.getByText(reason, { exact: true }).isVisible(), false);
        }
        const readiness = page.getByText(/Java\s*账号已同步/);
        assert.equal(await readiness.isVisible(), false);
        await page.getByRole('button', { name: '修复登录', exact: true }).hover();
        await readiness.waitFor();
        await maintenanceHeading.hover();
        await readiness.waitFor({ state: 'hidden' });
        assert.deepEqual(await readMaintenanceCalls(page), beforePress);
        await remove.click();
        await page.getByText('班级已从平台删除', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.__calls.filter(call => call.method === 'POST')), [
            { method: 'POST', url: '/sso/class/remove', body: { competitionId: 73 } }
        ]);
    } finally { await page.close(); }
});

test('saving the card binding updates maintenance on the normal catalog refresh', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        const title = page.getByRole('heading', { name: '已绑定实训', exact: true });
        const card = page.locator('.contest-card').filter({ has: title });
        const toolsTrigger = page.getByRole('button', { name: '展开编辑选项', exact: true });
        const toolsMenu = page.getByRole('group', { name: '系统工具菜单', exact: true });
        await title.waitFor();
        await toolsTrigger.click();
        await toolsMenu.getByRole('button', { name: '编辑', exact: true }).click();
        await card.getByRole('button', { name: '', exact: true }).first().click();
        const editor = page.getByRole('dialog');
        const mapping = editor.getByRole('checkbox', { name: /Java 班级删除映射/ });
        assert.equal(await mapping.isChecked(), true);
        await mapping.uncheck();
        await editor.getByRole('button', { name: '保存', exact: true }).click();
        await editor.waitFor({ state: 'detached' });
        await page.waitForFunction(() => window.__calls.filter(call => call.url === '/competitions').length === 2);
        await toolsTrigger.click();
        await toolsMenu.getByRole('button', { name: '完成编辑', exact: true }).click();
        const callsAfterSave = await readMaintenanceCalls(page);
        assert.equal(callsAfterSave.find(call => call.method === 'PUT' && call.url === '/competitions/73').body.classDeleteMapping.enabled, false);

        await holdCardForMaintenance(page, title);
        const remove = page.getByRole('button', { name: '删除班级', exact: true });
        await remove.waitFor();
        assert.equal(await remove.isDisabled(), true);
        const explanation = page.getByText('班级删除映射未配置', { exact: true });
        assert.equal(await explanation.isVisible(), false);
        await remove.locator('..').hover();
        await explanation.waitFor();
        assert.equal(await page.getByRole('button', { name: '修复登录', exact: true }).isEnabled(), true);
        assert.equal(await page.getByRole('button', { name: '初始化系统', exact: true }).isEnabled(), true);
        assert.deepEqual(await readMaintenanceCalls(page), callsAfterSave);
    } finally { await page.close(); }
});

test('long-pressing a direct card shows disabled deletion without starting an SSO request', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        const title = page.getByRole('heading', { name: '直达实训', exact: true });
        const remove = page.getByRole('button', { name: '删除班级', exact: true });
        await title.waitFor();
        const beforePress = await readMaintenanceCalls(page);
        await holdCardForMaintenance(page, title);
        await remove.waitFor();
        assert.equal(await remove.isDisabled(), true);
        const explanation = page.getByText('直接跳转不支持删除班级', { exact: true });
        assert.equal(await explanation.isVisible(), false);
        await remove.locator('..').hover();
        await explanation.waitFor();
        assert.equal(await page.getByRole('button', { name: '修复登录', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '初始化系统', exact: true }).count(), 0);
        assert.deepEqual(await readMaintenanceCalls(page), beforePress);
        assert.deepEqual(await page.evaluate(() => window.__notifications), []);
    } finally { await page.close(); }
});

test('a reset account must change its password before the workbench loads', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=app&mustChange=1`);
        const dialog = page.getByRole('dialog', { name: '请先修改登录密码', exact: true });
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true, 'Escape does not dismiss the required step');
        assert.equal(await page.getByRole('button', { name: '稍后修改' }).count(), 0);
        const protectedCalls = () => page.evaluate(() => window.__calls.filter(call => !['/auth/me', '/config/site'].includes(call.url)).map(call => call.url));
        assert.deepEqual(await protectedCalls(), [], 'no workbench requests run before the change');

        await page.getByLabel('新密码', { exact: true }).fill('123456');
        await page.getByLabel('确认新密码', { exact: true }).fill('123456');
        await page.getByRole('button', { name: '保存新密码并进入', exact: true }).click();
        await page.getByText('新密码不能继续使用默认密码 123456', { exact: true }).waitFor();
        assert.deepEqual(await protectedCalls(), []);

        await page.getByLabel('新密码', { exact: true }).fill('Chosen-Password-2026');
        await page.getByLabel('确认新密码', { exact: true }).fill('Chosen-Password-2026');
        await page.getByRole('button', { name: '保存新密码并进入', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: '打开个人资料', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => localStorage.getItem('authToken')), 'rotated-token');
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url === '/auth/change-password').length), 1);
    } finally { await page.close(); }
});

test('during the reminder period the workbench keeps the security card clear of the support launcher', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=app&remind=1`);
        await page.addStyleTag({ path: path.resolve('src/styles/support-chat.css') });
        await page.getByRole('button', { name: '打开个人资料', exact: true }).waitFor();
        assert.equal(await page.getByRole('dialog', { name: '请先修改登录密码' }).count(), 0, 'no lock before the deadline');
        const card = page.getByRole('region', { name: '完善账号安全', exact: true });
        await card.waitFor();
        await card.getByText('剩余 3 天', { exact: true }).waitFor();
        const box = await card.boundingBox();
        const launcher = page.getByRole('button', { name: /^打开客服/ });
        const launcherBox = await launcher.boundingBox();
        assert.ok(launcherBox, 'the support launcher is visible');
        assert.ok(box.x + box.width < launcherBox.x || box.y + box.height < launcherBox.y, 'security card and support launcher do not overlap');

        await card.getByRole('button', { name: '收起提醒', exact: true }).click();
        assert.match(await card.getAttribute('class'), /acct-card--exit/, 'collapsing plays the fold-away animation');
        await card.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: /账号安全待完善 · 剩余 3 天/ }).click();
        await card.waitFor();
        assert.match(await card.getAttribute('class'), /acct-card--enter/, 'expanding grows the card back out');

        await card.getByLabel('绑定邮箱', { exact: true }).fill('bad');
        await card.getByRole('button', { name: '绑定', exact: true }).click();
        await card.getByText('请输入有效的邮箱地址', { exact: true }).waitFor();
        await card.getByLabel('绑定邮箱', { exact: true }).fill('Fixture@Example.invalid');
        await card.getByRole('button', { name: '绑定', exact: true }).click();
        await card.getByLabel('绑定邮箱', { exact: true }).waitFor({ state: 'detached' });

        await card.getByLabel('新密码', { exact: true }).fill('Chosen-Password-2026');
        await card.getByLabel('确认新密码', { exact: true }).fill('Chosen-Password-2026');
        await card.getByRole('button', { name: '保存新密码', exact: true }).click();
        await card.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => localStorage.getItem('authToken')), 'rotated-token');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('authUser')).user.email), 'fixture@example.invalid');
    } finally { await page.close(); }
});

test('a reset account can sign out from the required password step', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=app&mustChange=1`);
        await page.getByRole('dialog', { name: '请先修改登录密码', exact: true }).waitFor();
        await page.getByRole('button', { name: '退出登录', exact: true }).click();
        await page.waitForFunction(() => localStorage.getItem('authToken') === null);
        assert.deepEqual(await page.evaluate(() => window.__revokedSessions), ['fixture-token']);
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
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('authUser')).user.avatarDataUrl), null);
    } finally { await page.close(); }
});

test('a provider return checks only its agent task after auth and catalog load and removes only its callback parameter', async () => {
    const page = await browser.newPage();
    try {
        const nextUrl = `${origin}/?mode=agent-modules&deferCatalog=1&deferAuth=success&agentTaskId=42&source=return#tasks`;
        const cleanUrl = `${origin}/?mode=agent-modules&deferCatalog=1&deferAuth=success&source=return#tasks`;
        await page.goto(nextUrl);
        await page.waitForFunction(() => typeof window.__releaseAuth === 'function');
        assert.equal(await page.evaluate(() => window.__calls.some(call => call.url === '/paas-v2/result')), false);
        assert.equal(page.url(), nextUrl);
        await page.evaluate(() => window.__releaseAuth());
        await page.waitForFunction(() => typeof window.__releaseCatalog === 'function');
        assert.equal(await page.evaluate(() => window.__calls.some(call => call.url === '/paas-v2/result')), false);
        assert.equal(page.url(), nextUrl);
        await page.evaluate(() => window.__releaseCatalog());
        const returnedTask = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '甲类指标解读' }) });
        await returnedTask.getByRole('button', { name: '得分详情', exact: true }).waitFor();
        assert.match(await returnedTask.getByRole('status').textContent(), /86\.5\s*分/);
        await page.waitForURL(cleanUrl);
        assert.deepEqual(await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            return window.__calls.filter(call => call.url === '/paas-v2/result');
        }), [{ method: 'POST', url: '/paas-v2/result', body: { competitionId: 42 } }]);

        await page.reload();
        await page.waitForFunction(() => typeof window.__releaseAuth === 'function');
        await page.evaluate(() => window.__releaseAuth());
        await page.waitForFunction(() => typeof window.__releaseCatalog === 'function');
        await page.evaluate(() => window.__releaseCatalog());
        await returnedTask.getByRole('heading', { name: '甲类指标解读' }).waitFor();
        assert.equal(await page.evaluate(() => window.__calls.some(call => call.url === '/paas-v2/result')), false);
    } finally { await page.close(); }
});

test('an agent return follows up while scoring, then stops at the final result', async () => {
    const page = await browser.newPage();
    try {
        await page.clock.install();
        await page.goto(`${origin}/?mode=agent-modules&deferCatalog=1&agentTaskId=42`);
        await page.waitForFunction(() => typeof window.__releaseCatalog === 'function');
        await page.evaluate(() => {
            window.__agentResult = { status: 'scoring', score: null };
            window.__releaseCatalog();
        });
        const task = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '甲类指标解读' }) });
        await task.getByRole('status').filter({ hasText: '评分中' }).waitFor();
        await page.evaluate(() => { window.__agentResult = { status: 'completed', score: 91 }; });
        await page.clock.fastForward(3100);
        await task.getByRole('button', { name: '得分详情', exact: true }).waitFor();
        assert.match(await task.getByRole('status').textContent(), /91\s*分/);
        await page.clock.fastForward(90_000);
        assert.deepEqual(await page.evaluate(() => window.__calls.filter(call => call.url === '/paas-v2/result').map(call => call.body.competitionId)), [42, 42]);
    } finally { await page.close(); }
});

test('reset cancels the next score check scheduled after an agent return', async () => {
    const page = await browser.newPage();
    try {
        await page.clock.install();
        await page.goto(`${origin}/?mode=agent-modules&deferCatalog=1&agentTaskId=42`);
        await page.waitForFunction(() => typeof window.__releaseCatalog === 'function');
        await page.evaluate(() => {
            window.__agentResult = { status: 'scoring', score: null };
            window.__releaseCatalog();
        });
        const task = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '甲类指标解读' }) });
        await task.getByRole('status').filter({ hasText: '评分中' }).waitFor();
        await task.getByRole('button', { name: '重置任务', exact: true }).click();
        await page.waitForFunction(() => window.__calls.some(call => call.url === '/paas-v2/reset'));
        // The reset awaits a catalog reload. Complete it using the normal fixture path.
        await page.evaluate(() => window.__releaseCatalog());
        await page.clock.fastForward(90_000);
        assert.deepEqual(await page.evaluate(() => window.__calls.filter(call => call.url === '/paas-v2/result').map(call => call.body.competitionId)), [42]);
    } finally { await page.close(); }
});

test('a return parameter for an unavailable or non-agent card does not trigger a score lookup', async () => {
    const page = await browser.newPage();
    try {
        const cleanUrl = `${origin}/?mode=agent-modules#tasks`;
        const invalidIds = [[99999], [90], ['42x'], [42, 51]];
        for (const taskIds of invalidIds) {
            const params = new URLSearchParams({ mode: 'agent-modules' });
            taskIds.forEach(taskId => params.append('agentTaskId', taskId));
            await page.goto(`${origin}/?${params}#tasks`);
            await page.waitForURL(cleanUrl);
            await page.getByRole('heading', { name: '甲类指标解读' }).waitFor();
            assert.equal(await page.evaluate(() => window.__calls.some(call => call.url === '/paas-v2/result')), false);
        }
    } finally { await page.close(); }
});

test('a provider return waits through a fresh login and looks up the returned task', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        const nextUrl = `${origin}/?mode=agent-modules&signedOut=1&deferCatalog=1&agentTaskId=42`;
        const cleanUrl = `${origin}/?mode=agent-modules&signedOut=1&deferCatalog=1`;
        await page.goto(nextUrl);
        await page.locator('#login-username').fill('fixture-user');
        assert.equal(page.url(), nextUrl);
        assert.equal(await page.evaluate(() => window.__calls.some(call => call.url === '/paas-v2/result')), false);
        await page.locator('#login-password').fill('fixture-password');
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.waitForFunction(() => typeof window.__releaseCatalog === 'function');
        assert.equal(page.url(), nextUrl);
        await page.evaluate(() => window.__releaseCatalog());
        const returnedTask = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '甲类指标解读' }) });
        await returnedTask.getByRole('button', { name: '得分详情', exact: true }).waitFor();
        await page.waitForURL(cleanUrl);
        assert.deepEqual(await page.evaluate(() => window.__calls
            .filter(call => call.url === '/paas-v2/result').map(call => call.body)), [{ competitionId: 42 }]);
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

test('a password change adopts the rotated token and sign-out revokes it on the server', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=auth&signedOut=1`);
        await page.getByText('anonymous', { exact: true }).waitFor();
        await page.evaluate(() => window.__session.handleLoginSuccess(
            { ...window.__profileUser, passwordChangeRecommended: true }, 'fixture-token', { animate: false }
        ));
        await page.waitForFunction(() => window.__session.authStatus === 'authenticated');
        const meCalls = await page.evaluate(() => window.__calls.filter(call => call.url === '/auth/me').length);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-token-rotated', {
            detail: { previous: 'fixture-token', token: 'rotated-token' }
        })));
        await page.waitForFunction(() => window.__session.token === 'rotated-token');
        assert.equal(await page.evaluate(() => localStorage.getItem('authToken')), 'rotated-token');
        assert.equal(await page.evaluate(() => window.__session.currentUser.passwordChangeRecommended), false);
        assert.equal(await page.evaluate(() => window.__calls.filter(call => call.url === '/auth/me').length), meCalls,
            'the rotated token is already verified');
        // A late 401 for the revoked token must not sign the user out.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-unauthorized', { detail: { token: 'fixture-token' } })));
        assert.equal(await page.getByTestId('session-user').textContent(), 'fixture-user');
        // A rotation for a token this tab does not hold is ignored.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-token-rotated', {
            detail: { previous: 'someone-else', token: 'foreign-token' }
        })));
        assert.equal(await page.evaluate(() => window.__session.token), 'rotated-token');
        await page.evaluate(() => window.__session.handleLogout());
        await page.getByText('anonymous', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.__revokedSessions), ['rotated-token']);
    } finally { await page.close(); }
});

test('switching accounts and signing out synchronizes already-open tabs', async () => {
    const context = await browser.newContext();
    try {
        const original = await context.newPage();
        const other = await context.newPage();
        const fixtureUrl = `${origin}/?mode=auth&signedOut=1`;
        await original.goto(fixtureUrl);
        await other.goto(fixtureUrl);
        await original.getByText('anonymous', { exact: true }).waitFor();
        await other.getByText('anonymous', { exact: true }).waitFor();
        await original.evaluate(() => window.__session.handleLoginSuccess(
            window.__profileUser, 'fixture-token', { animate: false }
        ));
        await other.getByText('fixture-user', { exact: true }).waitFor();
        await other.waitForFunction(() => window.__session.authStatus === 'authenticated');
        await other.evaluate(() => window.__session.handleLoginSuccess(
            { id: 8, username: 'replacement-user', role: 'student' }, 'replacement-token', { animate: false }
        ));
        await original.getByText('replacement-user', { exact: true }).waitFor();
        await original.waitForFunction(() => window.__session.authStatus === 'authenticated');
        assert.equal(await original.evaluate(() => window.__calls.filter(call => call.url === '/auth/me').length), 1);
        await other.evaluate(() => window.__session.handleLogout());
        await original.getByText('anonymous', { exact: true }).waitFor();
        assert.equal(await original.evaluate(() => window.__session.token), null);
    } finally { await context.close(); }
});

test('offline startup only restores a profile that belongs to the active login', async () => {
    const user = { id: 7, username: 'cached-user', role: 'student' };
    const payload = Buffer.from(JSON.stringify({ id: 7, role: 'student' })).toString('base64url');
    const token = `header.${payload}.fixture`;
    for (const [cached, expectedUser] of [
        [{ token, user }, 'cached-user'],
        [{ token: 'previous-login', user }, 'anonymous'],
        [user, 'cached-user'],
        [{ ...user, id: 8 }, 'anonymous']
    ]) {
        const page = await browser.newPage();
        try {
            await page.addInitScript(({ token, cached }) => {
                localStorage.setItem('authToken', token);
                localStorage.setItem('authUser', JSON.stringify(cached));
            }, { token, cached });
            await page.goto(`${origin}/?mode=auth&signedOut=1&authOffline=1`);
            await page.waitForFunction(() => window.__notifications?.length === 1);
            assert.equal(await page.getByTestId('session-user').textContent(), expectedUser);
        } finally { await page.close(); }
    }
});

test('system tools opens creation by keyboard and preserves the separate card editing mode', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        const trigger = page.getByRole('button', { name: '系统工具', exact: true });
        const menuToggle = page.getByRole('button', { name: '展开编辑选项', exact: true });
        const tools = page.locator('.nav-tools__menu');
        const edit = tools.getByRole('button', { name: '编辑', exact: true });
        const disclosure = tools.getByRole('button', { name: '展开创建选项' });
        await trigger.press('ArrowDown');
        await page.waitForFunction(() => document.activeElement?.textContent.trim() === '编辑');
        assert.equal(await menuToggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await tools.getByRole('button', { name: '系统设置', exact: true }).count(), 0);
        await edit.press('ArrowRight');
        const contest = tools.getByRole('button', { name: '创建竞赛卡片', exact: true });
        await page.waitForFunction(() => document.activeElement?.textContent.trim() === '创建竞赛卡片');
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
        assert.equal(await edit.getAttribute('aria-pressed'), 'false');
        await contest.press('Escape');
        assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
        await disclosure.press('Escape');
        assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');

        await menuToggle.press('Enter');
        await edit.click();
        assert.equal(await menuToggle.getAttribute('aria-expanded'), 'false');
        await menuToggle.press('Enter');
        const done = tools.getByRole('button', { name: '完成编辑', exact: true });
        assert.equal(await done.getAttribute('aria-pressed'), 'true');
        await done.click();
        await menuToggle.press('Enter');
        assert.equal(await edit.getAttribute('aria-pressed'), 'false');
    } finally { await page.close(); }
});

test('the settings switch keeps its button and focus through repeated page changes', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        const trigger = page.getByRole('button', { name: '系统工具', exact: true });
        const exit = page.getByRole('button', { name: '退出设置', exact: true });
        const workbench = page.locator('.dashboard-view--workbench');
        const settings = page.locator('.dashboard-view--settings');
        const originalButton = await trigger.elementHandle();

        for (let round = 0; round < 2; round++) {
            await trigger.press('Enter');
            assert.equal(await exit.evaluate((button, original) => button === original && document.activeElement === button, originalButton), true);
            assert.equal(await workbench.evaluate(element => element.inert), true);
            assert.equal(await settings.evaluate(element => element.inert), false);

            await exit.press('Enter');
            assert.equal(await trigger.evaluate((button, original) => button === original && document.activeElement === button, originalButton), true);
            assert.equal(await workbench.evaluate(element => element.inert), false);
            assert.equal(await settings.evaluate(element => element.inert), true);
        }
        await settings.locator('.settings-shell').waitFor({ state: 'detached' });
    } finally { await page.close(); }
});

test('sending a page of gifts produces one distinct, compact gift per recipient', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=maintenance`);
        await page.getByRole('button', { name: '系统工具' }).waitFor();
        await page.evaluate(() => {
            const previous = window.__testApi;
            window.__testApi = (method, url, ...args) => url.startsWith('/users?')
                ? Array.from({ length: 50 }, (_, index) => ({ id: index + 1, username: `student-${index + 1}`, role: 'student' }))
                : previous(method, url, ...args);
        });
        await page.getByRole('button', { name: '系统工具' }).click();
        await page.getByRole('button', { name: '赠送礼物' }).click();
        await page.getByRole('button', { name: 'student-50', exact: true }).waitFor();
        await page.getByPlaceholder(/礼物名称/).fill('Fixture gift');
        await page.getByPlaceholder(/请输入跳转链接/).fill('https://fixture.example/help');
        await page.getByRole('button', { name: '全选', exact: true }).click();
        await page.getByRole('button', { name: '发送礼物', exact: true }).click();
        const gifts = await page.evaluate(() => window.__calls.find(call => call.url === '/content/gifts').body);
        assert.equal(new Set(gifts.map(gift => gift.id)).size, 50);
        assert.equal(new Set(gifts.map(gift => gift.targetUserId)).size, 50);
        assert.ok(gifts.every(gift => /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(gift.id) && !('targetUsers' in gift)));
    } finally { await page.close(); }
});

test('site settings keeps a copy draft while appearance is saved and preserves both changes', async () => {
    const page = await browser.newPage();
    try {
        const readSiteWrites = () => page.evaluate(() => window.__calls
            .filter(call => call.method === 'POST' && call.url === '/config/site')
            .map(call => call.body));
        await page.goto(`${origin}/?mode=maintenance`);
        await page.getByRole('button', { name: '系统工具', exact: true }).click();

        const sidebar = page.locator('.settings-shell > aside');
        await sidebar.getByRole('button', { name: '站点设置', exact: true }).click();
        assert.equal(await sidebar.getByRole('button', { name: '全局文案', exact: true }).count(), 0);
        assert.equal(await sidebar.getByRole('button', { name: '界面外观', exact: true }).count(), 0);
        const sidebarLabels = (await sidebar.getByRole('button').allTextContents()).map(label => label.trim());
        const accessConfigIndex = sidebarLabels.indexOf('免密登录配置');
        assert.deepEqual(sidebarLabels.slice(accessConfigIndex, accessConfigIndex + 3), [
            '免密登录配置', '账号管理 API', '数据库配置'
        ]);

        const copyTab = page.getByRole('button', { name: '全局文案', exact: true });
        const appearanceTab = page.getByRole('button', { name: '界面外观', exact: true });
        await copyTab.click();
        const welcomeEditor = page.getByRole('textbox', { name: /显示文案/ });
        const initialWelcome = await welcomeEditor.inputValue();
        const draftWelcome = '欢迎访问测试站点';
        await welcomeEditor.fill(draftWelcome);

        await appearanceTab.click();
        await page.getByRole('button', { name: 'Dark', exact: true }).click();
        await page.getByText('当前：深色模式', { exact: true }).waitFor();
        const appearanceWrites = await readSiteWrites();
        assert.equal(appearanceWrites.length, 1);
        assert.equal(appearanceWrites[0].globalTheme.lightDark, 'dark');
        assert.equal(appearanceWrites[0].loginWelcomeTitle, initialWelcome);

        await copyTab.click();
        assert.equal(await welcomeEditor.inputValue(), draftWelcome);
        await page.getByRole('button', { name: '保存并生效', exact: true }).click();
        await page.getByRole('button', { name: '已保存并生效', exact: true }).waitFor();
        const writes = await readSiteWrites();
        assert.equal(writes.length, 2);
        assert.equal(writes[1].loginWelcomeTitle, draftWelcome);
        assert.deepEqual(writes[1].globalTheme, appearanceWrites[0].globalTheme);
    } finally { await page.close(); }
});

test('swiping theme cards saves once and queued choices keep newer appearance settings', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        const readWrites = () => page.evaluate(() => window.__calls
            .filter(call => call.method === 'POST' && call.url === '/config/site')
            .map(({ body }) => [body.globalTheme.effectMode, body.globalTheme.manualColor, body.globalTheme.lightDark]));
        const choose = color => page.locator(`.theme-carousel-swatch[data-theme-key=${color}]`).click();
        const release = () => page.evaluate(() => {
            const resolve = window.__releaseThemeSave;
            window.__releaseThemeSave = null;
            resolve();
        });

        await page.goto(`${origin}/?mode=maintenance`);
        // The component fixture omits the app stylesheet. Supply the snapping layout for the mouse gesture.
        await page.addStyleTag({ content: `
            .theme-carousel-viewport { width: min(75vw, 660px); overflow: auto hidden; scroll-snap-type: x mandatory; }
            .theme-carousel-rail { display: flex; width: 100%; }
            .theme-carousel-rail::before, .theme-carousel-rail::after { content: ''; flex: 0 0 15%; }
            .theme-carousel-slide { flex: 0 0 70%; min-width: 0; height: 150px; scroll-snap-align: center; }
            .theme-carousel-art { width: 100%; height: 100px; pointer-events: none; }
        ` });
        await page.getByRole('button', { name: '系统工具', exact: true }).click();
        await page.getByRole('button', { name: '站点设置', exact: true }).click();
        await page.getByRole('button', { name: '界面外观', exact: true }).click();
        await page.getByRole('button', { name: /手动选择主色调/ }).click();
        const viewport = page.locator('.theme-carousel-viewport');
        await viewport.scrollIntoViewIfNeeded();
        const initialWrites = await readWrites();
        assert.equal(initialWrites.length, 1);
        const [initialMode, initialColor, initialLightDark] = initialWrites[0];
        assert.equal(initialMode, 'color');
        assert.equal(initialColor, 'blue');

        await page.evaluate(() => {
            const original = window.__testApi;
            window.__holdThemeColor = 'red';
            window.__testApi = async (method, url, body, ...args) => {
                const response = await original(method, url, body, ...args);
                if (method === 'POST' && url === '/config/site' && body.globalTheme.manualColor === window.__holdThemeColor) {
                    window.__holdThemeColor = null;
                    await new Promise(resolve => { window.__releaseThemeSave = resolve; });
                }
                return response;
            };
        });

        const { x, y, width, height } = await viewport.boundingBox();
        await page.mouse.move(x + width * .75, y + height / 2);
        await page.mouse.down();
        await page.mouse.move(x + width * .2, y + height / 2, { steps: 10 });
        assert.deepEqual(await readWrites(), initialWrites);
        await page.mouse.up();
        await page.waitForFunction(() => typeof window.__releaseThemeSave === 'function');
        assert.deepEqual(await readWrites(), [...initialWrites, ['color', 'red', initialLightDark]]);

        await choose('orange');
        await choose('yellow');
        await page.getByRole('button', { name: 'Dark', exact: true }).click();
        await release();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('competition_hub_site_config')).globalTheme.manualColor === 'yellow');
        const afterDark = [...initialWrites, ['color', 'red', initialLightDark], ['color', 'red', 'dark'], ['color', 'yellow', 'dark']];
        assert.deepEqual(await readWrites(), afterDark);

        await page.evaluate(() => { window.__holdThemeColor = 'green'; });
        await choose('green');
        await page.waitForFunction(() => typeof window.__releaseThemeSave === 'function');
        await choose('teal');
        await page.getByRole('button', { name: /默认效果/ }).click();
        await release();
        await viewport.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Light', exact: true }).click();
        await page.getByText('当前：浅色模式', { exact: true }).waitFor();
        assert.deepEqual(await readWrites(), [...afterDark, ['color', 'green', 'dark'], ['default', 'green', 'dark'], ['default', 'green', 'light']]);
    } finally { await page.close(); }
});

test('a wide SVG uploads as a proportional transparent raster image and malformed SVG is rejected', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=logo-upload`);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120"><rect x="120" y="30" width="240" height="60" fill="#236bc5"/></svg>';
        const image = await page.evaluate(async markup => {
            const file = new File([markup], 'brand.svg', { type: 'image/svg+xml' });
            const dataUrl = await window.__prepareLogoDataUrl(file);
            const raster = await (await fetch(dataUrl)).blob();
            const bitmap = await createImageBitmap(raster);
            try {
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const context = canvas.getContext('2d');
                context.drawImage(bitmap, 0, 0);
                return {
                    type: raster.type,
                    size: raster.size,
                    width: bitmap.width,
                    height: bitmap.height,
                    cornerAlpha: context.getImageData(0, 0, 1, 1).data[3],
                    centerAlpha: context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data[3]
                };
            } finally { bitmap.close(); }
        }, svg);
        assert.match(image.type, /^image\/(png|webp)$/);
        assert.ok(image.size > 0 && image.size <= 100 * 1024);
        assert.ok(image.width > 0 && image.height > 0);
        assert.ok(Math.abs(image.width / image.height - 4) < 0.05, `${image.width}x${image.height}`);
        assert.equal(image.cornerAlpha, 0);
        assert.equal(image.centerAlpha, 255);

        await assert.rejects(page.evaluate(() => window.__prepareLogoDataUrl(new File(
            ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120"><rect></svg>'],
            'broken.svg', { type: 'image/svg+xml' }
        ))));
    } finally { await page.close(); }
});

test('brand image alignment balances visible pixels within transparent margins', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${origin}/?mode=logo-upload`);
        const offsets = await page.evaluate(async () => {
            const getOffset = async shapes => {
                const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100">${shapes}</svg>`;
                const image = new Image();
                image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
                await image.decode();
                return window.__getBrandImageCenterOffset(image);
            };
            // The body and descender have centered outer bounds, but vary in visual weight.
            const wordmark = '<rect x="40" y="20" width="320" height="30"/><rect x="180" y="50" width="40" height="30"/>';
            return {
                upper: await getOffset(wordmark),
                mirrored: await getOffset(`<g transform="translate(0 100) scale(1 -1)">${wordmark}</g>`),
                centered: await getOffset('<rect x="100" y="25" width="200" height="50"/>'),
                nearTop: await getOffset('<rect x="100" y="8" width="200" height="20"/>'),
                empty: await getOffset('')
            };
        });
        assert.ok(offsets.upper > 11 && offsets.upper < 12.5, `upper offset: ${offsets.upper}%`);
        assert.ok(Math.abs(offsets.upper + offsets.mirrored) < 0.1);
        assert.equal(offsets.centered, 0);
        assert.equal(offsets.nearTop, 12.5);
        assert.equal(offsets.empty, 0);
    } finally { await page.close(); }
});

test('80 competition cards share the dashboard clock and skip idle dimension reads', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    try {
        await page.clock.install();
        await page.addInitScript(() => {
            window.__cardDimensionsRead = 0;
            for (const property of ['offsetWidth', 'offsetHeight']) {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
                Object.defineProperty(HTMLElement.prototype, property, {
                    ...descriptor,
                    get() {
                        if (this.classList.contains('contest-card')) window.__cardDimensionsRead++;
                        return descriptor.get.call(this);
                    }
                });
            }
            const interval = window.setInterval.bind(window);
            window.__halfMinuteTimers = 0;
            window.setInterval = (callback, delay, ...args) => {
                if (delay === 30_000) window.__halfMinuteTimers++;
                return interval(callback, delay, ...args);
            };
        });
        await page.goto(`${origin}/?mode=app&timedCards=1`);
        await page.getByRole('heading', { name: 'Fixture card 80', exact: true }).waitFor();
        const timedCard = page.locator('.contest-card').filter({ has: page.getByRole('heading', { name: 'Fixture card 1', exact: true }) });
        await timedCard.getByText(/开启/).waitFor();
        await page.evaluate(() => window.dispatchEvent(new Event('resize')));
        assert.equal(await page.evaluate(() => window.__cardDimensionsRead), 0);
        assert.equal(await page.evaluate(() => window.__halfMinuteTimers), 1);
        await page.clock.fastForward(31_000);
        await timedCard.getByText('长期开放', { exact: true }).waitFor();
    } finally { await page.close(); }
});
