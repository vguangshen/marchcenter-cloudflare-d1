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
const providerCalls = [];

before(async () => {
    harness = await createProductionHarness();
    const createStudent = async (id) => {
        const user = { id, username: `support-user-${id}`, role: 'student' };
        await harness.seedUser(user);
        return { Authorization: `Bearer ${await harness.issueToken(user)}` };
    };
    [student, aiStudent, raceStudent] = await Promise.all([createStudent(61), createStudent(62), createStudent(63)]);
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

test('AI reuses the configured mcgo provider after disclosure and forwards only the current text', async () => {
    const saved = await harness.api('/api/ai/config', { method: 'PUT', body: {
        provider: 'openai', apiUrl: 'https://support-ai.example.invalid/v1', modelName: 'support-fixture', apiKey: API_KEY,
        systemPrompt: 'A separate instruction for the competition guide.'
    } });
    assert.equal(saved.status, 200, saved.text);
    harness.platform.fetch = async request => {
        assert.equal(request.url, 'https://support-ai.example.invalid/v1/chat/completions');
        assert.equal(request.headers.get('Authorization'), `Bearer ${API_KEY}`);
        providerCalls.push(await request.json());
        return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '请先检查工作台中的卡片访问权限。' }] }] });
    };
    const configured = await harness.api(OPTIONS, { method: 'PUT', body: { templates: [template], aiEnabled: true } });
    assert.equal(configured.status, 200, configured.text);
    assert.equal(configured.data.aiConfigured, true);

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

test('a provider response in flight yields to a human reply', async () => {
    const started = Promise.withResolvers();
    const final = Promise.withResolvers();
    harness.platform.fetch = async () => {
        started.resolve();
        await final.promise;
        return Response.json({ choices: [{ message: { content: '这是稍后返回的 AI 回复。' } }] });
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
    assert.equal(result.data.messages.length, 2);
    assert.equal(result.data.messages.at(-1).body, '人工客服已经接手。');
});
