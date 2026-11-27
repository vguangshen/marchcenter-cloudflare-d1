import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

// 1×1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let harness;
let studentToken;
let otherToken;
let adminToken;
let ownedCard;
let foreignCard;

before(async () => {
    harness = await createProductionHarness();
    await harness.seedUser({ id: 20, username: 'ticket-student', role: 'student' });
    await harness.seedUser({ id: 21, username: 'ticket-other', role: 'student' });
    await harness.seedUser({ id: 22, username: 'ticket-admin', role: 'admin' });
    studentToken = await harness.issueToken({ id: 20, username: 'ticket-student', role: 'student' });
    otherToken = await harness.issueToken({ id: 21, username: 'ticket-other', role: 'student' });
    adminToken = await harness.issueToken({ id: 22, username: 'ticket-admin', role: 'admin' });
    const configId = await harness.seedConfig({});
    ownedCard = await harness.seedCompetition({ configId, method: 'none' });
    foreignCard = await harness.seedCompetition({ configId, method: 'none' });
    await harness.run("UPDATE competitions SET title = '数字化大赛' WHERE id = ?", ownedCard);
    await harness.run('INSERT INTO user_access_policies (user_id, configured) VALUES (20, 1), (21, 1)');
    await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (20, ?)', ownedCard);
});
after(async () => { await harness?.dispose(); });

async function call(token, pathname, { method = 'GET', form, json } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (form) {
        // Encode with Node's own fetch types; Miniflare's undici does not take them as-is.
        const encoded = new Response(form);
        headers['Content-Type'] = encoded.headers.get('content-type');
        body = new Uint8Array(await encoded.arrayBuffer());
    } else if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    }
    const response = await harness.miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, { method, headers, body });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, data };
}

function ticketForm(fields, files = []) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    for (const file of files) form.append('files', file);
    return form;
}

test('a student files a ticket about their own card, with a screenshot', async () => {
    const created = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        competitionId: String(ownedCard), category: 'auto_login', subject: '自动登录一直失败', description: '点击卡片后提示账号或密码错误'
    }, [new File([PNG], 'screen.png', { type: 'image/png' })]) });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const ticketId = created.data.ticket.id;

    const detail = await call(studentToken, `/api/tickets/${ticketId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.ticket.cardTitle, '数字化大赛');
    assert.equal(detail.data.ticket.status, 'open');
    assert.equal(detail.data.messages.length, 1);
    const [attachment] = detail.data.messages[0].attachments;
    assert.equal(attachment.contentType, 'image/png');

    const file = await call(studentToken, `/api/tickets/${ticketId}/attachments/${attachment.id}`);
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(file.data), PNG);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('cache-control'), /no-store/);
    assert.match(file.headers.get('content-security-policy'), /sandbox/);

    // Neither the ticket nor its file is visible to another student.
    assert.equal((await call(otherToken, `/api/tickets/${ticketId}`)).status, 404);
    assert.equal((await call(otherToken, `/api/tickets/${ticketId}/attachments/${attachment.id}`)).status, 404);
    assert.equal((await call(otherToken, '/api/tickets?scope=all')).status, 403);
    assert.equal((await call(otherToken, '/api/tickets')).data.tickets.length, 0);
});

test('a card the student cannot use is refused, as are unsafe or oversized files', async () => {
    const foreign = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        competitionId: String(foreignCard), category: 'score', subject: '别人的卡片', description: '这张卡片不是我的'
    }) });
    assert.equal(foreign.status, 403);

    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'x.svg', { type: 'image/svg+xml' });
    const disguised = new File(['<html><script>alert(1)</script></html>'], 'fake.png', { type: 'image/png' });
    for (const file of [svg, disguised]) {
        const rejected = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
            category: 'other', subject: '附件测试', description: '带一个不安全的附件'
        }, [file]) });
        assert.equal(rejected.status, 415, file.name);
    }

    const tooMany = Array.from({ length: 6 }, (_, index) => new File([PNG], `${index}.png`, { type: 'image/png' }));
    const many = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'other', subject: '附件太多', description: '六个附件超过上限'
    }, tooMany) });
    assert.equal(many.status, 400);

    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'big.txt', { type: 'text/plain' });
    const oversized = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'other', subject: '附件太大', description: '单个附件超过 10MB'
    }, [big]) });
    assert.equal(oversized.status, 413);

    const badCategory = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'nope', subject: '类型错误', description: '问题类型不在列表里'
    }) });
    assert.equal(badCategory.status, 400);

    const count = await harness.rows("SELECT COUNT(*) AS n FROM support_tickets WHERE subject IN ('别人的卡片', '附件测试', '附件太多', '附件太大', '类型错误')");
    assert.equal(count[0].n, 0, 'nothing is stored for a refused submission');
});

test('admin replies flip unread counters and status, and the owner can close and reopen', async () => {
    const created = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'account', subject: '忘记密码', description: '登录不了，需要重置密码'
    }, [new File(['line one\nline two'], 'error.log', { type: 'text/plain' })]) });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.ticket.id;

    const staffBadge = await call(adminToken, '/api/tickets/unread');
    assert.ok(staffBadge.data.staff >= 1, 'a new ticket is unread for administrators');
    const all = await call(adminToken, '/api/tickets?scope=all&status=active');
    assert.ok(all.data.tickets.some(ticket => ticket.id === id && ticket.ownerUsername === 'ticket-student'));

    const staffView = await call(adminToken, `/api/tickets/${id}`);
    assert.equal(staffView.data.viewer.owner, false);
    assert.equal(staffView.data.messages[0].attachments[0].contentType, 'text/plain; charset=utf-8');
    const [{ staff_unread: cleared }] = await harness.rows('SELECT staff_unread FROM support_tickets WHERE id = ?', id);
    assert.equal(cleared, 0);

    const reply = await call(adminToken, `/api/tickets/${id}/messages`, { method: 'POST', form: ticketForm({ body: '已为你重置，请查收邮件' }) });
    assert.equal(reply.status, 201);
    assert.equal(reply.data.status, 'in_progress');
    assert.equal((await call(studentToken, '/api/tickets/unread')).data.mine, 1);
    const ownerView = await call(studentToken, `/api/tickets/${id}`);
    assert.equal(ownerView.data.messages.at(-1).authorRole, 'staff');
    assert.equal((await call(studentToken, '/api/tickets/unread')).data.mine, 0, 'opening the ticket marks it read');

    // Students may not resolve tickets themselves, only close or reopen them.
    assert.equal((await call(studentToken, `/api/tickets/${id}/status`, { method: 'PATCH', json: { status: 'resolved' } })).status, 403);
    assert.equal((await call(adminToken, `/api/tickets/${id}/status`, { method: 'PATCH', json: { status: 'resolved' } })).status, 200);
    const followUp = await call(studentToken, `/api/tickets/${id}/messages`, { method: 'POST', form: ticketForm({ body: '还是登录不了' }) });
    assert.equal(followUp.data.status, 'open', 'a reply to a resolved ticket reopens it');

    assert.equal((await call(studentToken, `/api/tickets/${id}/status`, { method: 'PATCH', json: { status: 'closed' } })).status, 200);
    const closedReply = await call(studentToken, `/api/tickets/${id}/messages`, { method: 'POST', form: ticketForm({ body: '再问一下' }) });
    assert.equal(closedReply.status, 409);
    assert.equal((await call(studentToken, `/api/tickets/${id}/status`, { method: 'PATCH', json: { status: 'open' } })).status, 200);

    const systemNotes = await harness.rows("SELECT body FROM support_ticket_messages WHERE ticket_id = ? AND author_role = 'system'", id);
    assert.equal(systemNotes.length, 3);
});

test('failed replies and status changes leave the thread, unread count and attachment storage unchanged', async () => {
    const created = await call(studentToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'card_display', subject: '卡片封面不显示', description: '打开页面后卡片封面一直空白'
    }) });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const { id } = created.data.ticket;
    const attachmentBucket = await harness.miniflare.getR2Bucket('TICKET_FILES');
    const storedKeys = async () => (await attachmentBucket.list()).objects.map(object => object.key).sort();
    const initialKeys = await storedKeys();
    const sendReply = () => call(adminToken, `/api/tickets/${id}/messages`, {
        method: 'POST',
        form: ticketForm({ body: '请查看示例截图' }, [new File([PNG], 'example.png', { type: 'image/png' })])
    });
    await harness.run(`CREATE TRIGGER reject_ticket_update BEFORE UPDATE OF user_unread ON support_tickets
        WHEN OLD.id = ${id} BEGIN SELECT RAISE(ABORT, 'injected ticket update failure'); END`);
    try {
        const failed = await sendReply();
        assert.equal(failed.status, 500, JSON.stringify(failed.data));
        const failedStatus = await call(adminToken, `/api/tickets/${id}/status`, { method: 'PATCH', json: { status: 'resolved' } });
        assert.equal(failedStatus.status, 500, JSON.stringify(failedStatus.data));
        assert.deepEqual(await harness.rows('SELECT status, user_unread FROM support_tickets WHERE id = ?', id), [
            { status: 'open', user_unread: 0 }
        ]);
        assert.deepEqual(await harness.rows('SELECT author_role FROM support_ticket_messages WHERE ticket_id = ?', id), [
            { author_role: 'user' }
        ]);
        assert.deepEqual(await harness.rows('SELECT id FROM support_ticket_attachments WHERE ticket_id = ?', id), []);
        assert.deepEqual(await storedKeys(), initialKeys);
    } finally {
        await harness.run('DROP TRIGGER reject_ticket_update');
    }

    const retried = await sendReply();
    assert.equal(retried.status, 201, JSON.stringify(retried.data));
    const detail = await call(studentToken, `/api/tickets/${id}`);
    assert.equal(detail.data.ticket.status, 'in_progress');
    assert.equal(detail.data.messages.length, 2);
    assert.equal(detail.data.messages[1].attachments[0].fileName, 'example.png');
    assert.equal((await storedKeys()).length, initialKeys.length + 1);
});

test('simultaneous tickets respect the remaining daily allowance', async () => {
    await harness.run(`INSERT INTO support_tickets (user_id, category, subject)
        SELECT 21, 'other', '历史工单 ' || value FROM json_each(?)`, JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    const attachmentBucket = await harness.miniflare.getR2Bucket('TICKET_FILES');
    const initialAttachmentCount = (await attachmentBucket.list()).objects.length;
    const submit = subject => call(otherToken, '/api/tickets', { method: 'POST', form: ticketForm({
        category: 'other', subject, description: '在最后一个每日工单名额提交的问题'
    }, [new File([PNG], 'check.png', { type: 'image/png' })]) });
    const results = await Promise.all([submit('功能使用咨询'), submit('页面状态咨询')]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 429]);
    assert.deepEqual(await harness.rows('SELECT COUNT(*) AS count FROM support_tickets WHERE user_id = 21'), [{ count: 10 }]);
    const { id } = results.find(result => result.status === 201).data.ticket;
    assert.deepEqual(await harness.rows('SELECT author_role FROM support_ticket_messages WHERE ticket_id = ?', id), [
        { author_role: 'user' }
    ]);
    assert.deepEqual(await harness.rows('SELECT file_name FROM support_ticket_attachments WHERE ticket_id = ?', id), [
        { file_name: 'check.png' }
    ]);
    assert.equal((await attachmentBucket.list()).objects.length, initialAttachmentCount + 1);
});
