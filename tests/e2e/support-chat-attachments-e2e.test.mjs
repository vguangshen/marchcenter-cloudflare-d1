import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const BASE = '/api/support-chat';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let harness;
const tokens = {};

before(async () => {
    harness = await createProductionHarness();
    tokens.staff = harness.token;
    for (const [id, username] of [[20, 'owner'], [21, 'other']]) {
        const user = { id, username, role: 'student' };
        await harness.seedUser(user);
        tokens[username] = await harness.issueToken(user);
    }
});

after(async () => { await harness?.dispose(); });

async function call(actor, path, { text, files, json } = {}) {
    const headers = actor ? { Authorization: `Bearer ${tokens[actor]}` } : {};
    let body;
    if (files) {
        const form = new FormData();
        if (text !== undefined) form.set('body', text);
        for (const file of files) form.append('files', file);
        const encoded = new Response(form);
        headers['Content-Type'] = encoded.headers.get('Content-Type');
        body = new Uint8Array(await encoded.arrayBuffer());
    } else if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
    }
    const response = await harness.miniflare.dispatchFetch(`http://marchcenter.local${BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers, body
    });
    const type = response.headers.get('Content-Type');
    const data = type?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { data, status: response.status, headers: response.headers };
}

test('files-only and mixed messages support private image previews and file downloads', async () => {
    const ownerSent = await call('owner', '/messages', { files: [new File([PNG], '截图.png')] });
    assert.equal(ownerSent.status, 201, JSON.stringify(ownerSent.data));
    const { conversation, message } = ownerSent.data;
    assert.equal(conversation.lastMessage, '（附件）');
    assert.equal(message.body, '');
    const [image] = message.attachments;
    assert.deepEqual(image, { id: image.id, fileName: '截图.png', contentType: 'image/png', size: PNG.length });

    const path = `/conversations/${conversation.id}`;
    const imagePath = `${path}/attachments/${image.id}`;
    for (const actor of ['owner', 'staff']) {
        const imageFile = await call(actor, imagePath);
        assert.equal(imageFile.status, 200);
        assert.deepEqual(imageFile.data, PNG);
        assert.equal(imageFile.headers.get('Content-Type'), 'image/png');
        assert.match(imageFile.headers.get('Content-Disposition'), /^inline;/);
        assert.match(imageFile.headers.get('Cache-Control'), /private, no-store/);
        assert.match(imageFile.headers.get('Content-Security-Policy'), /sandbox/);
        assert.equal(imageFile.headers.get('X-Content-Type-Options'), 'nosniff');
    }
    assert.equal((await call(null, imagePath)).status, 401);
    assert.equal((await call('other', imagePath)).status, 404);

    const log = new Uint8Array(2 * 1024 * 1024).fill(97);
    const staffSent = await call('staff', `${path}/messages`, {
        text: '请查看说明',
        files: [new File([log], '说明.log'), new File([PNG], '示意.png')]
    });
    assert.equal(staffSent.status, 201, JSON.stringify(staffSent.data));
    assert.equal(staffSent.data.message.authorRole, 'staff');
    assert.deepEqual(staffSent.data.message.attachments.map(attachment => attachment.fileName), ['说明.log', '示意.png']);
    const history = await call('owner', path);
    assert.deepEqual(history.data.messages, [message, staffSent.data.message]);
    const [document] = staffSent.data.message.attachments;
    const download = await call('owner', `${path}/attachments/${document.id}`);
    assert.equal(download.status, 200);
    assert.deepEqual(download.data, Buffer.from(log));
    assert.match(download.headers.get('Content-Disposition'), /^attachment;/);

    const ownOther = await call('other', '/messages', { json: { body: '另一条会话' } });
    assert.equal(ownOther.status, 201);
    assert.deepEqual(ownOther.data.message.attachments, []);
    assert.equal((await call('staff', `/conversations/${ownOther.data.conversation.id}/attachments/${image.id}`)).status, 404);
});

test('attachment validation and failed D1 writes leave the conversation and R2 storage intact', async () => {
    const path = '/messages';
    const bucket = await harness.miniflare.getR2Bucket('TICKET_FILES');
    const keys = async () => (await bucket.list({ prefix: 'support-chat/' })).objects.map(object => object.key).sort();
    const beforeKeys = await keys();
    const beforeMessages = await harness.rows('SELECT id FROM support_chat_messages ORDER BY id');
    const fakeImage = new File(['<html>无效的图片</html>'], 'bad.png', { type: 'image/png' });
    assert.equal((await call('owner', path, { files: [fakeImage] })).status, 415);
    assert.equal((await call('owner', path, { files: Array.from({ length: 6 }, () => new File([PNG], 'small.png')) })).status, 400);

    await harness.run(`CREATE TRIGGER reject_support_attachment_test BEFORE INSERT ON support_chat_attachments
        WHEN NEW.file_name = 'reject.log' BEGIN SELECT RAISE(ABORT, 'injected attachment failure'); END`);
    try {
        assert.equal((await call('owner', path, { files: [new File(['日志'], 'reject.log')] })).status, 500);
    } finally {
        await harness.run('DROP TRIGGER reject_support_attachment_test');
    }
    assert.deepEqual(await keys(), beforeKeys);
    assert.deepEqual(await harness.rows('SELECT id FROM support_chat_messages ORDER BY id'), beforeMessages);
});
