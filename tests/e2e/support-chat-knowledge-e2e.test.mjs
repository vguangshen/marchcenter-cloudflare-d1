import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const API = '/api/support-chat';
const KNOWLEDGE = `${API}/knowledge`;
const category = '演练语料';
const sharedExample = '北斗验收项目如何处理';
const roles = {};
let harness;

before(async () => {
    harness = await createProductionHarness();
    for (const [id, role] of [[90, 'student'], [91, 'teacher'], [92, 'admin']]) {
        const user = { id, username: `knowledge-${role}`, role };
        await harness.seedUser(user);
        roles[role] = { Authorization: `Bearer ${await harness.issueToken(user)}` };
    }
});

after(async () => { await harness?.dispose(); });

const template = (question, example, answer) => ({
    category, question, answer, enabled: true, examples: [example, sharedExample], keywords: [], followUp: `进一步说明：${answer}`
});

async function addEntry(payload) {
    const created = await harness.api(KNOWLEDGE, { headers: roles.admin, body: payload });
    assert.equal(created.status, 201, created.text);
    return created.data.entry;
}

async function recognize(text, contextIntentId) {
    const result = await harness.api(`${KNOWLEDGE}/test`, { headers: roles.admin, body: { text, contextIntentId } });
    assert.equal(result.status, 200, result.text);
    return result.data;
}

async function send(text) {
    const result = await harness.api(`${API}/messages`, { headers: roles.student, body: { body: text } });
    assert.equal(result.status, 201, result.text);
    return result.data;
}

async function waitForAnswer(sent) {
    const { conversation, message } = sent;
    for (let attempt = 0; attempt < 50; attempt++) {
        const rows = await harness.rows("SELECT id FROM support_chat_messages WHERE conversation_id = ? AND id > ? AND author_role = 'staff'", conversation.id, message.id);
        if (rows.length) {
            const thread = await harness.api(`${API}/conversations/${conversation.id}`, { headers: roles.student });
            assert.equal(thread.status, 200, thread.text);
            return thread.data.messages.find(item => item.id === rows[0].id);
        }
        await delay(35);
    }
    assert.fail('No support answer was saved');
}

test('staff can list, filter and revise live knowledge without exposing the editor to other roles', async () => {
    assert.equal((await harness.api(KNOWLEDGE, { headers: { Authorization: '' } })).status, 401);
    for (const role of ['student', 'teacher']) {
        assert.equal((await harness.api(KNOWLEDGE, { headers: roles[role] })).status, 403);
        assert.equal((await harness.api(`${KNOWLEDGE}/test`, { headers: roles[role], body: { text: '测试' } })).status, 403);
    }
    const first = await harness.api(KNOWLEDGE, { headers: roles.admin });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.data.entries.length, 24);
    assert.ok(first.data.summary.intents >= 80);
    assert.ok(first.data.summary.examples >= first.data.summary.intents * 4);
    assert.ok(first.data.categories.length >= 7);
    assert.ok(first.data.entries.every(entry => entry.enabled && entry.builtin));

    const entry = await addEntry(template('银杉演练如何登记', '银杉演练在哪里登记', '打开演练台，再选择登记。'));
    assert.equal(entry.builtin, false);
    const duplicate = await harness.api(KNOWLEDGE, { headers: roles.admin, body: { ...entry, question: `${entry.question}？` } });
    assert.equal(duplicate.status, 409);
    const found = await harness.api(`${KNOWLEDGE}?category=${encodeURIComponent(category)}&state=enabled&q=${encodeURIComponent('银杉演练在哪里')}`, { headers: roles.admin });
    assert.deepEqual(found.data.entries.map(item => item.id), [entry.id]);
    assert.equal((await recognize('银杉演练在哪里登记')).entry.id, entry.id);

    const saved = await harness.api(`${KNOWLEDGE}/${entry.id}`, { method: 'PUT', headers: roles.admin, body: { ...entry, answer: '在银杉演练台选择登记。' } });
    assert.equal(saved.status, 200, saved.text);
    assert.notEqual(saved.data.entry.revision, entry.revision);
    const stale = await harness.api(`${KNOWLEDGE}/${entry.id}`, { method: 'PATCH', headers: roles.admin, body: { enabled: false, revision: entry.revision } });
    assert.equal(stale.status, 409);
    const disabled = await harness.api(`${KNOWLEDGE}/${entry.id}`, { method: 'PATCH', headers: roles.admin, body: { enabled: false, revision: saved.data.entry.revision } });
    assert.equal(disabled.status, 200, disabled.text);
    assert.equal(disabled.data.entry.enabled, false);
    assert.equal((await recognize('银杉演练在哪里登记')).kind, 'none');
});

test('live conversation clarifies competing intents and remembers the chosen topic for a detail request', async () => {
    const entries = await Promise.all([
        addEntry(template('如何打开北斗甲演练', '北斗甲演练怎么启动', '打开北斗甲面板，然后选择启动。')),
        addEntry(template('如何打开北斗乙演练', '北斗乙演练怎么启动', '打开北斗乙面板，然后选择启动。'))
    ]);
    const expected = new Map(entries.map(entry => [entry.id, entry]));
    const trial = await recognize(sharedExample);
    assert.equal(trial.kind, 'clarify');
    assert.deepEqual(new Set(trial.entries.map(item => item.id)), new Set(expected.keys()));

    const clarification = await waitForAnswer(await send(sharedExample));
    assert.match(clarification.body, /哪一项/);
    assert.equal(clarification.knowledge.choices.length, 2);
    const chosen = expected.get(clarification.knowledge.choices[1].id);
    const answer = await waitForAnswer(await send('选第二个'));
    assert.equal(answer.body, chosen.answer);
    assert.equal(answer.knowledge.intentId, chosen.id);

    const detailsText = '详细一点';
    const detailTrial = await recognize(detailsText, chosen.id);
    assert.equal(detailTrial.mode, 'followup');
    const detail = await waitForAnswer(await send(detailsText));
    assert.equal(detail.body, chosen.followUp);
    assert.deepEqual(detail.knowledge, { intentId: chosen.id, followedUp: true });
    assert.equal((await recognize('银河系的距离是多少')).kind, 'none');

    await waitForAnswer(await send(sharedExample));
    const declined = await send('都不是');
    const handoff = await waitForAnswer(declined);
    assert.match(handoff.body, /已转接人工客服/);
    const thread = await harness.api(`${API}/conversations/${declined.conversation.id}`, { headers: roles.student });
    assert.equal(thread.data.conversation.humanRequested, true);
});

test('existing quick questions use the built-in corpus and administrators can update its answers', async () => {
    for (const text of ['卡片打不开怎么办？', '如何找回账号密码？', '如何提交工单？']) {
        const result = await recognize(text);
        assert.equal(result.kind, 'match');
        assert.equal(result.entry.builtin, true);
    }
    const text = '如何找回账号密码？';
    const { entry } = await recognize(text);
    const answer = '用已绑定的邮箱完成验证，再设置新的密码。';
    const edited = await harness.api(`${KNOWLEDGE}/${entry.id}`, { method: 'PUT', headers: roles.admin, body: { ...entry, answer } });
    assert.equal(edited.status, 200, edited.text);
    assert.equal(edited.data.entry.builtin, true);
    assert.equal((await recognize(text)).entry.answer, answer);
});
