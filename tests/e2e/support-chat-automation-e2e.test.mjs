import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const OPTIONS = '/api/support-chat/options';
const MESSAGES = '/api/support-chat/messages';
const AUTOMATION = '/api/support-chat/automation';
const API_KEY = 'mock-support-key-not-real';
const template = {
    id: 'course-hours', question: '怎么看课程开放时间？', answer: '打开工作台，查看卡片上显示的开放时间。', keywords: ['课程开放时间']
};
let harness;
let student;
let aiStudent;
let raceStudent;
let directStudent;
let followupStudent;
let declinedStudent;

before(async () => {
    harness = await createProductionHarness();
    const createStudent = async (id) => {
        const user = { id, username: `support-user-${id}`, role: 'student' };
        await harness.seedUser(user);
        return { Authorization: `Bearer ${await harness.issueToken(user)}` };
    };
    [student, aiStudent, raceStudent, directStudent, followupStudent, declinedStudent] = await Promise.all(
        [61, 62, 63, 64, 65, 66].map(createStudent)
    );
});

after(async () => { await harness?.dispose(); });

async function waitForRow(sql, ...values) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const [row] = await harness.rows(sql, ...values);
        if (row) return row;
        await delay(25);
    }
    assert.fail(`Expected row did not appear: ${sql}`);
}

async function enableSupportAi() {
    const saved = await harness.api('/api/ai/config', { method: 'PUT', body: {
        provider: 'openai', apiUrl: 'https://support-ai.example.invalid/v1', modelName: 'support-fixture', apiKey: API_KEY,
        systemPrompt: 'A separate instruction for the competition guide.'
    } });
    assert.equal(saved.status, 200, saved.text);
    const configured = await harness.api(OPTIONS, { method: 'PUT', body: { templates: [template], aiEnabled: true } });
    assert.equal(configured.status, 200, configured.text);
    assert.equal(configured.data.aiConfigured, true);
}

async function waitForHandoff(id, headers) {
    const unread = await waitForRow(
        'SELECT user_unread, staff_unread FROM support_chat_conversations WHERE id = ? AND human_requested = 1',
        id
    );
    assert.ok(unread.user_unread > 0, 'handoff notice alerts the customer');
    assert.ok(unread.staff_unread > 0, 'handoff alerts support staff');

    const thread = await harness.api(`/api/support-chat/conversations/${id}`, { headers });
    assert.equal(thread.status, 200, thread.text);
    assert.equal(thread.data.conversation.humanRequested, true);
    const notice = thread.data.messages.at(-1);
    assert.equal(notice.authorRole, 'staff');
    assert.equal(notice.replySource, null);
    assert.match(notice.body, /已转接?人工客服/);
    return notice;
}

test('support FAQs are configurable only by a super admin and produce a labeled template reply', async () => {
    const initial = await harness.api(OPTIONS, { headers: student });
    assert.equal(initial.status, 200, initial.text);
    assert.equal(initial.data.aiEnabled, false);
    assert.ok(initial.data.templates.length > 0);
    assert.ok(initial.data.templates.every(item => !('answer' in item || 'keywords' in item)));
    const payload = { templates: [template], aiEnabled: false };
    assert.equal((await harness.api(OPTIONS, { method: 'PUT', headers: student, body: payload })).status, 403);
    assert.equal((await harness.api(OPTIONS, { method: 'PUT', body: { ...payload, aiEnabled: true } })).status, 409);
    assert.equal((await harness.api(OPTIONS, { method: 'PUT', body: { ...payload, templates: [template, template] } })).status, 400);
    assert.deepEqual((await harness.api(OPTIONS, { method: 'PUT', body: payload })).data.templates, [template]);

    const opened = await harness.api(MESSAGES, { headers: student, body: { body: '请问课程开放时间在哪里？' } });
    assert.equal(opened.status, 201, opened.text);
    const id = opened.data.conversation.id;
    const automatic = await waitForRow("SELECT body FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    assert.equal(automatic.body, template.answer);
    const thread = await harness.api(`/api/support-chat/conversations/${id}`, { headers: student });
    assert.equal(thread.data.messages.at(-1).replySource, 'template');

    const handoff = await harness.api(AUTOMATION, { method: 'PATCH', headers: student, body: { humanRequested: true } });
    assert.equal(handoff.status, 200, handoff.text);
    assert.equal(handoff.data.conversation.humanRequested, true);
    assert.ok(handoff.data.message);
    const repeated = await harness.api(AUTOMATION, { method: 'PATCH', headers: student, body: { humanRequested: true } });
    assert.equal(repeated.data.message, null);
    const humanQuestion = await harness.api(MESSAGES, { headers: student, body: { body: template.question, allowAi: true } });
    assert.equal(humanQuestion.data.conversation.humanRequested, true);
    const resumed = await harness.api(AUTOMATION, { method: 'PATCH', headers: student, body: { humanRequested: false } });
    assert.equal(resumed.data.conversation.humanRequested, false);
    const question = await harness.api(MESSAGES, { headers: student, body: { body: template.question } });
    const afterResume = await waitForRow("SELECT body FROM support_chat_messages WHERE conversation_id = ? AND id > ? AND reply_source = 'template'", id, question.data.message.id);
    assert.equal(afterResume.body, template.answer);
    const templates = await harness.rows("SELECT COUNT(*) AS total FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    assert.equal(templates[0].total, 2);
});

test('only an affirmative transfer request enters human support and staff can finish the handoff', async () => {
    const configured = await harness.api(OPTIONS, { method: 'PUT', body: { templates: [template], aiEnabled: false } });
    assert.equal(configured.status, 200, configured.text);
    const headers = directStudent;
    const greeting = await harness.api(MESSAGES, { headers, body: { body: '你好！' } });
    assert.equal(greeting.status, 201, greeting.text);
    const { id } = greeting.data.conversation;
    const threadPath = `/api/support-chat/conversations/${id}`;
    for (const body of ['报名需要人工审核吗？', 'Do I need human approval for enrollment?']) {
        const ordinaryMessage = await harness.api(MESSAGES, { headers, body: { body } });
        assert.equal(ordinaryMessage.status, 201, ordinaryMessage.text);
    }
    await delay(80);
    const greeted = await harness.api(threadPath, { headers });
    assert.equal(greeted.status, 200, greeted.text);
    assert.equal(greeted.data.conversation.humanRequested, false);

    const negated = await harness.api(MESSAGES, { headers, body: { body: '先不用转人工，我只想问课程开放时间。' } });
    assert.equal(negated.status, 201, negated.text);
    const automatic = await waitForRow("SELECT id FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    const answered = await harness.api(threadPath, { headers });
    assert.equal(answered.data.conversation.humanRequested, false);
    assert.equal(answered.data.messages.at(-1).id, automatic.id);

    await enableSupportAi();
    let aiCalls = 0;
    harness.platform.fetch = async () => {
        aiCalls += 1;
        return Response.json({ choices: [{ message: { content: 'This request should go straight to staff.' } }] });
    };
    const requested = await harness.api(MESSAGES, { headers, body: { body: '请帮我转人工客服。', allowAi: true } });
    assert.equal(requested.status, 201, requested.text);
    const notice = await waitForHandoff(id, headers);
    assert.equal(aiCalls, 0, 'an explicit transfer skips the AI provider');

    const repeated = await harness.api(MESSAGES, { headers, body: { body: '请转人工，课程开放时间依旧没显示。', allowAi: true } });
    assert.equal(repeated.status, 201, repeated.text);
    assert.equal(repeated.data.conversation.humanRequested, true);
    const waiting = await harness.api(threadPath, { headers });
    assert.deepEqual(waiting.data.messages.filter(message => message.authorRole === 'staff').map(message => message.id), [
        automatic.id, notice.id
    ]);

    const finishPath = `${threadPath}/finish-handoff`;
    const denied = await harness.api(finishPath, { method: 'POST', headers });
    assert.equal(denied.status, 403, denied.text);
    const finished = await harness.api(finishPath, { method: 'POST' });
    assert.equal(finished.status, 200, finished.text);
    assert.equal(finished.data.conversation.humanRequested, false);

    const resumed = await harness.api(MESSAGES, { headers, body: { body: template.question } });
    assert.equal(resumed.status, 201, resumed.text);
    const reply = await waitForRow(
        "SELECT body FROM support_chat_messages WHERE conversation_id = ? AND id > ? AND reply_source = 'template'",
        id, resumed.data.message.id
    );
    assert.equal(reply.body, template.answer);
});

test('a failed FAQ follow-up transfers to staff when AI is unavailable', async () => {
    const configured = await harness.api(OPTIONS, { method: 'PUT', body: { templates: [template], aiEnabled: false } });
    assert.equal(configured.status, 200, configured.text);
    const headers = followupStudent;
    const opened = await harness.api(MESSAGES, { headers, body: { body: template.question } });
    assert.equal(opened.status, 201, opened.text);
    const { id } = opened.data.conversation;
    await waitForRow("SELECT id FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    const acknowledged = await harness.api(MESSAGES, { headers, body: { body: '谢谢，已经解决了。' } });
    assert.equal(acknowledged.status, 201, acknowledged.text);
    const reopened = await harness.api(MESSAGES, { headers, body: { body: template.question } });
    assert.equal(reopened.status, 201, reopened.text);
    await waitForRow(
        "SELECT id FROM support_chat_messages WHERE conversation_id = ? AND id > ? AND reply_source = 'template'",
        id, reopened.data.message.id
    );
    const read = await harness.api(`/api/support-chat/conversations/${id}`, { headers });
    assert.equal(read.data.conversation.humanRequested, false);

    const followup = await harness.api(MESSAGES, {
        headers, body: { body: '我按步骤试过了，还是不行，课程开放时间依旧看不到。' }
    });
    assert.equal(followup.status, 201, followup.text);
    await waitForHandoff(id, headers);
    const replies = await harness.rows("SELECT id FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    assert.equal(replies.length, 2, 'the bot answers fresh questions but does not repeat the unsuccessful FAQ');
});

test('AI reuses the configured mcgo provider after disclosure and forwards only the current text', async () => {
    await enableSupportAi();
    const providerCalls = [];
    harness.platform.fetch = async request => {
        assert.equal(request.url, 'https://support-ai.example.invalid/v1/chat/completions');
        assert.equal(request.headers.get('Authorization'), `Bearer ${API_KEY}`);
        providerCalls.push(await request.json());
        return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '请先检查工作台中的卡片访问权限。' }] }] });
    };

    await harness.api(MESSAGES, { headers: aiStudent, body: { body: '从未同意发给模型的内容' } });
    const form = new FormData();
    form.set('body', '请查看我发给人工客服的附件。');
    form.set('allowAi', 'true');
    form.set('files', new File(['私有客服附件'], 'details.txt', { type: 'text/plain' }));
    const encoded = new Response(form);
    const attached = await harness.miniflare.dispatchFetch(`http://marchcenter.local${MESSAGES}`, {
        method: 'POST',
        headers: { ...aiStudent, 'Content-Type': encoded.headers.get('Content-Type') },
        body: new Uint8Array(await encoded.arrayBuffer())
    });
    assert.equal(attached.status, 201, await attached.text());

    const text = '工作台上显示的卡片和别人的不一样。';
    const question = await harness.api(MESSAGES, { headers: aiStudent, body: { body: text, allowAi: true } });
    assert.equal(question.status, 201, question.text);
    const id = question.data.conversation.id;
    const generated = await waitForRow("SELECT body FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'ai'", id);
    assert.match(generated.body, /检查工作台/);
    assert.equal(providerCalls.length, 1);
    const [call] = providerCalls;
    assert.equal(call.model, 'support-fixture');
    assert.deepEqual(call.messages.slice(1), [{ role: 'user', content: text }]);
    assert.match(call.messages[0].content, /mcgo 平台的客服助手/);
    assert.ok(!JSON.stringify(call).includes(API_KEY));
    await harness.api(MESSAGES, { headers: aiStudent, body: { body: '连续请求时是否重复消耗 AI？', allowAi: true } });
    await delay(80);
    assert.equal(providerCalls.length, 1, 'the same conversation is rate limited');
});

test('an AI refusal after a failed FAQ transfers to staff without showing the provider marker', async () => {
    await enableSupportAi();
    const headers = declinedStudent;
    const opened = await harness.api(MESSAGES, { headers, body: { body: template.question } });
    assert.equal(opened.status, 201, opened.text);
    const { id } = opened.data.conversation;
    await waitForRow("SELECT id FROM support_chat_messages WHERE conversation_id = ? AND reply_source = 'template'", id);
    const read = await harness.api(`/api/support-chat/conversations/${id}`, { headers });
    assert.equal(read.data.conversation.humanRequested, false);

    const text = '这个办法试过了，还是不行。';
    const providerCalls = [];
    harness.platform.fetch = async request => {
        providerCalls.push((await request.json()).messages.at(-1).content);
        return Response.json({ choices: [{ message: { content: '[人工客服]' } }] });
    };
    const followup = await harness.api(MESSAGES, { headers, body: { body: text, allowAi: true } });
    assert.equal(followup.status, 201, followup.text);
    await waitForHandoff(id, headers);
    assert.deepEqual(providerCalls, [text], 'after an unsuccessful FAQ the recent question is sent to AI once');
    const replies = await harness.rows("SELECT reply_source FROM support_chat_messages WHERE conversation_id = ? AND reply_source IS NOT NULL", id);
    assert.deepEqual(replies, [{ reply_source: 'template' }]);
});

test('a provider handoff in flight yields to a human reply', async () => {
    await enableSupportAi();
    const started = Promise.withResolvers();
    const final = Promise.withResolvers();
    harness.platform.fetch = async () => {
        started.resolve();
        await final.promise;
        return Response.json({ choices: [{ message: { content: '[人工客服]' } }] });
    };
    const question = await harness.api(MESSAGES, { headers: raceStudent, body: { body: '我想询问工作台的常用设置。', allowAi: true } });
    const id = question.data.conversation.id;
    try {
        assert.equal(await Promise.race([started.promise.then(() => true), delay(1500, false)]), true, 'provider call started');
        const human = await harness.api(`/api/support-chat/conversations/${id}/messages`, { body: { body: '人工客服已经接手。' } });
        assert.equal(human.status, 201, human.text);
    } finally {
        final.resolve();
    }
    await delay(120);
    const result = await harness.api(`/api/support-chat/conversations/${id}`, { headers: raceStudent });
    assert.equal(result.data.conversation.humanRequested, false);
    assert.equal(result.data.messages.length, 2);
    assert.equal(result.data.messages.at(-1).body, '人工客服已经接手。');
});
