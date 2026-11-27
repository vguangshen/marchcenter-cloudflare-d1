import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const base = '/api/support-chat';
const tokens = {};
let harness;

before(async () => {
    harness = await createProductionHarness();
    for (const user of [
        { id: 20, username: 'chat-student', role: 'student' },
        { id: 21, username: 'chat-other', role: 'student' },
        { id: 22, username: 'chat-admin', role: 'admin' },
        { id: 23, username: 'chat-teacher', role: 'teacher' }
    ]) {
        await harness.seedUser(user);
        tokens[user.username] = await harness.issueToken(user);
    }
});
after(async () => { await harness?.dispose(); });

async function call(account, pathname, json) {
    const headers = account ? { Authorization: 'Bearer ' + tokens[account] } : {};
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const response = await harness.miniflare.dispatchFetch('http://marchcenter.local' + pathname, {
        method: json === undefined ? 'GET' : 'POST',
        headers,
        body: json === undefined ? undefined : JSON.stringify(json)
    });
    return { status: response.status, data: await response.json() };
}

test('support conversations are independent of tickets and private to their owner and platform administrators', async () => {
    assert.equal((await call(null, base + '/conversations')).status, 401);
    const opened = await call('chat-student', base + '/messages', { body: '   我想咨询竞赛开放时间。  ' });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const { conversation, message } = opened.data;
    assert.equal(conversation.ownerUsername, 'chat-student');
    assert.equal(message.authorRole, 'user');
    assert.equal(message.body, '我想咨询竞赛开放时间。');
    assert.match(message.createdAt, /^\d{4}-\d\d-\d\dT.*Z$/);
    const thread = base + '/conversations/' + conversation.id;

    const ownList = await call('chat-student', base + '/conversations');
    assert.deepEqual(ownList.data.conversations.map(item => item.id), [conversation.id]);
    assert.deepEqual((await call('chat-student', '/api/tickets')).data.tickets, []);
    assert.deepEqual((await call('chat-other', base + '/conversations')).data.conversations, []);
    assert.equal((await call('chat-other', thread)).status, 404);
    assert.equal((await call('chat-other', thread + '/messages', { body: '这不是我的会话。' })).status, 404);
    assert.equal((await call('chat-teacher', thread)).status, 404);
    assert.equal((await call('chat-teacher', base + '/conversations?scope=all')).status, 403);

    assert.deepEqual((await call('chat-admin', base + '/unread')).data, { total: 1, mine: 0, staff: 1 });
    const queue = await call('chat-admin', base + '/conversations');
    assert.deepEqual(queue.data.conversations.map(item => item.id), [conversation.id]);
    const staffView = await call('chat-admin', thread);
    assert.deepEqual(staffView.data.viewer, { owner: false, staff: true });
    assert.equal(staffView.data.messages[0].id, message.id);
    assert.deepEqual((await call('chat-admin', base + '/unread')).data, { total: 0, mine: 0, staff: 0 });

    const reply = await call('chat-admin', thread + '/messages', { body: '你好，开放时间请查看赛事公告。' });
    assert.equal(reply.status, 201, JSON.stringify(reply.data));
    assert.equal(reply.data.message.authorRole, 'staff');
    assert.deepEqual((await call('chat-student', base + '/unread')).data, { total: 1, mine: 1, staff: 0 });
    const nextReply = await call('chat-admin', thread + '/messages', { body: '有其他问题可以随时留言。' });
    assert.equal(nextReply.status, 201, JSON.stringify(nextReply.data));
    assert.deepEqual((await call('chat-student', base + '/unread')).data, { total: 2, mine: 2, staff: 0 });
    const ownerView = await call('chat-student', thread);
    assert.deepEqual(ownerView.data.viewer, { owner: true, staff: false });
    assert.deepEqual(ownerView.data.messages.map(item => item.id), [message.id, reply.data.message.id, nextReply.data.message.id]);
    assert.deepEqual((await call('chat-student', base + '/unread')).data, { total: 0, mine: 0, staff: 0 });
});

test('validates message size and keeps simultaneous sends in the same conversation', async () => {
    for (const invalid of ['', '  \n ', '中'.repeat(2001), { text: '内容' }]) {
        assert.equal((await call('chat-other', base + '/messages', { body: invalid })).status, 400);
    }
    assert.deepEqual((await call('chat-other', base + '/conversations')).data.conversations, []);

    const bodies = ['同时提交的第一条消息', '同时提交的第二条消息'];
    const sent = await Promise.all(bodies.map(body => call('chat-other', base + '/messages', { body })));
    assert.deepEqual(sent.map(item => item.status), [201, 201]);
    const id = sent[0].data.conversation.id;
    assert.equal(sent[1].data.conversation.id, id);
    const ownList = await call('chat-other', base + '/conversations');
    assert.deepEqual(ownList.data.conversations.map(item => item.id), [id]);
    assert.deepEqual((await call('chat-admin', base + '/unread')).data, { total: 2, mine: 0, staff: 2 });
    const thread = await call('chat-other', base + '/conversations/' + id);
    assert.deepEqual(thread.data.messages.map(message => message.body).sort(), bodies.toSorted());
});

test('older history is paginated without clearing unread newer replies', async () => {
    const opened = await call('chat-teacher', base + '/messages', { body: '我想咨询教学卡片。' });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const { id } = opened.data.conversation;
    await harness.run(
        "INSERT INTO support_chat_messages (conversation_id, author_id, author_role, body) SELECT ?, 22, 'staff', '历史回复 ' || value FROM json_each(?)",
        id, JSON.stringify(Array.from({ length: 51 }, (_, index) => index + 1))
    );
    const thread = base + '/conversations/' + id;
    const latest = await call('chat-teacher', thread);
    assert.equal(latest.data.hasMore, true);
    assert.equal(latest.data.messages.length, 50);
    assert.equal(latest.data.messages[0].body, '历史回复 2');
    assert.equal(latest.data.messages.at(-1).body, '历史回复 51');

    const reply = await call('chat-admin', thread + '/messages', { body: '这是新的回复。' });
    assert.equal(reply.status, 201);
    const history = await call('chat-teacher', thread + '?before=' + latest.data.messages[0].id);
    assert.equal(history.data.hasMore, false);
    assert.deepEqual(history.data.messages.map(message => message.body), ['我想咨询教学卡片。', '历史回复 1']);
    assert.equal((await call('chat-teacher', base + '/unread')).data.mine, 1);
    const refreshed = await call('chat-teacher', thread);
    assert.equal(refreshed.data.messages.at(-1).id, reply.data.message.id);
    assert.equal((await call('chat-teacher', base + '/unread')).data.mine, 0);
});
