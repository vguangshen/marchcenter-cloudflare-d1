import assert from 'node:assert/strict';
import test from 'node:test';
import builtInKnowledge from '../server/data/supportChatKnowledge.js';
import { buildSupportIntentIndex, isSupportIntentFollowUp, recognizeSupportIntent } from '../server/utils/supportChatIntent.js';

test('intent matching normalizes formatting and recognizes Chinese paraphrases', () => {
    const index = buildSupportIntentIndex(builtInKnowledge);
    const variants = new Map([
        ['提示用户名或密码错误 ？ 怎么办。', 'login-password-rejected'],
        ['我的工作台登录密码想不起来了', 'login-forgot-password'],
        ['我的登录邮箱一直没收到验证码', 'email-code-not-received'],
        ['我没收到找回密码邮件，收件箱没有这封信', 'email-code-not-received'],
        ['验证码我收到了不过显示已用过', 'email-code-expired'],
        ['我不想重置密码，我要换绑定邮箱', 'account-replace-email'],
        ['客服窗口太大了能不能收起来', 'chat-minimize'],
        ['我工单提交完从哪里看进度', 'ticket-track'],
        ['为什么卡片列表是空的', 'workbench-empty-cards'],
        ['怎么跟客服发照片', 'chat-add-files']
    ]);
    for (const [message, expected] of variants) {
        const result = recognizeSupportIntent(message, index);
        assert.equal(result.kind, 'match', message);
        assert.equal(result.entry.id, expected, message);
    }
});

test('shared examples give bounded clarification and disabled entries never match', () => {
    const example = '北斗验收项目怎么处理';
    const makeEntry = (id, enabled = true) => ({ id, question: `${id}项目明细`, examples: [example], enabled });
    const index = buildSupportIntentIndex([
        makeEntry('已停用', false), makeEntry('甲'), makeEntry('乙'), makeEntry('丙'), makeEntry('丁')
    ]);
    const result = recognizeSupportIntent(example, index, { contextIntentId: '已停用' });
    assert.equal(result.kind, 'clarify');
    assert.equal(result.gap, 0);
    assert.deepEqual(result.entries.map(entry => entry.id), ['甲', '乙', '丙']);
    assert.equal(recognizeSupportIntent('已停用项目明细', index).kind, 'none');
});

test('failure reports with an action name prefer troubleshooting and abstain if unavailable', () => {
    const index = buildSupportIntentIndex(builtInKnowledge);
    const routine = buildSupportIntentIndex(builtInKnowledge.filter(entry => entry.id === 'task-continue'));
    for (const message of ['点击继续智能体任务后弹出一个错误', '点「继续智能体任务」超时了']) {
        const result = recognizeSupportIntent(message, index);
        assert.equal(result.kind, 'match', message);
        assert.equal(result.entry.id, 'task-open-error', message);
        assert.equal(recognizeSupportIntent(message, routine).kind, 'none', message);
    }
    assert.equal(recognizeSupportIntent('智能体题做一半关掉了怎么继续', index).entry.id, 'task-continue');
});

test('an earlier topic does not force a match for unrelated or generic input', () => {
    const index = buildSupportIntentIndex(builtInKnowledge);
    const context = { contextIntentId: 'login-forgot-password' };
    for (const message of ['你知道今天是星期几吗', '密码', '我朋友在手机那边等我', '验证码', '电脑打不开电源怎么办', '我不需要重置密码', '找不到同学的练习进度']) {
        assert.equal(recognizeSupportIntent(message, index, context).kind, 'none', message);
    }
});

test('only generic requests for more detail are treated as intent follow-ups', () => {
    for (const message of ['那具体怎么操作？', '可以详细说一下吗', '具体步骤呢', 'Show me the steps.']) {
        assert.equal(isSupportIntentFollowUp(message), true, message);
    }
    for (const message of ['还是打不开', '我需要人工', '下一步怎么换绑定邮箱', '具体怎么提交工单', '']) {
        assert.equal(isSupportIntentFollowUp(message), false, message);
    }
});
