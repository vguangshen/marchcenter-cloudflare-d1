import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { testBrowserOptions } from '../helpers/browser.mjs';
import { createProductionHarness } from './helpers/productionHarness.mjs';

async function openUserDirectory(t, actor) {
    const listener = createServer().listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const { port } = listener.address();
    await new Promise(resolve => listener.close(resolve));
    const harness = await createProductionHarness({ port, bindings: { CORS_ORIGINS: `http://127.0.0.1:${port}` } });
    t.after(() => harness.dispose());
    await harness.seedUser({ id: 2, username: 'teacher-a', role: 'teacher' });
    await harness.seedUser({ id: 3, username: 'student-a', role: 'student' });
    await harness.seedUser({ id: 4, username: 'student-b', role: 'student' });
    await harness.run("INSERT INTO classes (id, name, teacher_user_id) VALUES (1, 'Class A', 2)");
    await harness.run("UPDATE users SET class_id = 1, last_ip = '2001:db8:1234:5678:abcd:1111:2222:3333' WHERE id IN (2, 3, 4)");

    const browser = await chromium.launch(testBrowserOptions());
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    if (actor) await harness.seedUser(actor);
    const token = actor ? await harness.issueToken(actor) : harness.token;
    await page.addInitScript(value => localStorage.setItem('authToken', value), token);
    await page.goto((await harness.miniflare.ready).href);
    await page.getByRole('button', { name: '系统工具' }).click();
    await page.getByRole('button', { name: '用户管理' }).click();
    return { harness, page };
}

test('class members expand under their teacher and account actions fit a narrow screen', async t => {
    const { page } = await openUserDirectory(t);

    const expand = page.getByRole('button', { name: /展开 teacher-a 的学生/ });
    await expand.waitFor();
    assert.equal((await expand.innerText()).trim(), '2 名学生');
    assert.equal(await page.getByText('Class A', { exact: true }).count(), 0);
    assert.equal(await page.getByText('student-a', { exact: true }).count(), 0);
    await expand.click();
    const members = page.getByRole('list', { name: 'teacher-a 的学生', exact: true });
    const manage = members.getByRole('button', { name: '管理 student-a' });
    await manage.click();
    const actions = members.getByRole('group', { name: 'student-a 的管理操作' });
    for (const width of [1280, 768, 320]) {
        await page.setViewportSize({ width, height: 800 });
        const boxes = [];
        for (const name of ['权限配置', '重置密码', '禁用用户']) {
            const box = await actions.getByRole('button', { name, exact: true }).boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 32, name);
            assert.ok(boxes.every(previous => previous.x + previous.width <= box.x || previous.y + previous.height <= box.y), name);
            boxes.push(box);
        }
    }
    await page.getByRole('button', { name: /收起 teacher-a 的学生/ }).click();
    await members.waitFor({ state: 'hidden' });
    await page.getByRole('searchbox').fill('student-a');
    await members.getByText('student-a', { exact: true }).waitFor();
    await page.getByText('匹配 1 个账号', { exact: true }).waitFor();
});

test('an administrator deletes one nested student only from the account management menu', async t => {
    const { harness, page } = await openUserDirectory(t, { id: 5, username: 'manager', role: 'admin' });
    await page.getByText('共 4 个账号', { exact: true }).waitFor();
    const ownRow = page.getByRole('listitem').filter({ has: page.getByText('manager', { exact: true }) });
    await ownRow.getByText('当前账号', { exact: true }).waitFor();
    assert.equal(await ownRow.getByRole('button', { name: /删除|权限配置|管理 manager/ }).count(), 0);

    await page.getByRole('button', { name: /展开 teacher-a 的学生，2 名学生/ }).click();
    const members = page.getByRole('list', { name: 'teacher-a 的学生', exact: true });
    await members.getByRole('button', { name: '管理 student-a', exact: true }).click();
    const actions = members.getByRole('group', { name: 'student-a 的管理操作' });
    await actions.getByRole('button', { name: '权限配置', exact: true }).click();
    const permissions = page.getByRole('dialog', { name: '模块权限与时间控制', exact: true });
    await permissions.waitFor();
    assert.equal(await permissions.getByRole('button', { name: '删除此账号', exact: true }).count(), 0);
    await permissions.getByRole('button', { name: '关闭权限设置窗口' }).click();
    await permissions.waitFor({ state: 'hidden' });
    const remove = actions.getByRole('button', { name: '删除此账号', exact: true });
    await remove.click();
    const confirmation = page.getByRole('alertdialog', { name: '删除账号', exact: true });
    assert.match(await confirmation.innerText(), /student-a/);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.ok(await remove.isVisible());
    const storedIds = async () => (await harness.rows('SELECT id FROM users ORDER BY id')).map(user => user.id);
    assert.deepEqual(await storedIds(), [1, 2, 3, 4, 5]);

    await remove.click();
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    await page.getByText('共 3 个账号', { exact: true }).waitFor();
    await page.getByRole('button', { name: /收起 teacher-a 的学生，1 名学生/ }).waitFor();
    await members.getByText('student-a', { exact: true }).waitFor({ state: 'detached' });
    await members.getByText('student-b', { exact: true }).waitFor();
    assert.deepEqual(await storedIds(), [1, 2, 4, 5]);
});
