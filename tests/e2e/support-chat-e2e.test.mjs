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

test('staff can review queue totals and find conversations by status, name or number', async () => {
    const overviewPath = base + '/management/overview';
    assert.equal((await call(null, overviewPath)).status, 401);
    assert.equal((await call('chat-student', overviewPath)).status, 403);
    assert.equal((await call('chat-teacher', overviewPath)).status, 403);
    assert.equal((await call('chat-student', base + '/conversations?scope=all&queue=human&q=chat')).status, 403);

    const baseline = await call('chat-admin', overviewPath);
    assert.equal(baseline.status, 200);
    const users = JSON.stringify(Array.from({ length: 33 }, (_, index) => index + 1));
    await harness.run(
        `INSERT INTO users (id, username, email, password_hash, role, is_disabled)
         SELECT value + 100, 'queue-test-' || value, 'queue-' || value || '@example.invalid', 'unused', 'student', 0
         FROM json_each(?)`,
        users
    );
    await harness.run(
        `INSERT INTO support_chat_conversations (id, user_id, human_requested, staff_unread)
         SELECT value + 1000, value + 100, value <= 31, CASE WHEN value IN (1, 2, 32) THEN 2 ELSE 0 END
         FROM json_each(?)`,
        users
    );
    await harness.run('INSERT INTO support_chat_conversations (id, user_id, human_requested, staff_unread) VALUES (2000, 22, 1, 10)');
    await harness.run(
        `INSERT INTO support_chat_messages (conversation_id, author_id, author_role, reply_source, body) VALUES
         (1001, 101, 'user', NULL, '最近的提问'),
         (1001, NULL, 'staff', 'template', '常见问题回复'),
         (1001, NULL, 'staff', 'ai', 'AI 回复'),
         (1001, 22, 'staff', NULL, '人工回复'),
         (1001, NULL, 'staff', NULL, '自动转接通知'),
         (2000, 22, 'user', NULL, '客服自己的提问')`
    );
    await harness.run(
        `INSERT INTO support_chat_messages (conversation_id, author_id, author_role, body, created_at)
         VALUES (1001, 101, 'user', '更早的提问', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'))`
    );

    const overview = await call('chat-admin', overviewPath);
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.data, {
        totalConversations: baseline.data.totalConversations + 33,
        humanConversations: baseline.data.humanConversations + 31,
        unreadMessages: baseline.data.unreadMessages + 6,
        recentUserMessages: baseline.data.recentUserMessages + 1,
        recentTemplateReplies: baseline.data.recentTemplateReplies + 1,
        recentAiReplies: baseline.data.recentAiReplies + 1,
        recentHumanReplies: baseline.data.recentHumanReplies + 1
    });

    const queuePath = base + '/conversations?scope=all';
    const all = await call('chat-admin', queuePath + '&queue=all&q=QUEUE-TEST');
    assert.equal(all.status, 200);
    assert.equal(all.data.conversations.length, 30);
    assert.equal(all.data.total, 33);
    assert.equal(all.data.totalPages, 2);
    const human = await call('chat-admin', queuePath + '&queue=human&q=QUEUE-TEST&page=2');
    assert.equal(human.status, 200);
    assert.equal(human.data.page, 2);
    assert.equal(human.data.total, 31);
    assert.equal(human.data.totalPages, 2);
    assert.deepEqual(human.data.conversations.map(conversation => conversation.id), [1001]);

    const unread = await call('chat-admin', queuePath + '&queue=unread&q=QUEUE-TEST');
    assert.equal(unread.status, 200);
    assert.equal(unread.data.total, 3);
    assert.equal(unread.data.totalPages, 1);
    assert.deepEqual(unread.data.conversations.map(conversation => conversation.id).sort(), [1001, 1002, 1032]);
    const byNumber = await call('chat-admin', queuePath + '&q=%231032');
    assert.equal(byNumber.status, 200);
    assert.equal(byNumber.data.total, 1);
    assert.equal(byNumber.data.conversations[0].ownerUsername, 'queue-test-32');
});
