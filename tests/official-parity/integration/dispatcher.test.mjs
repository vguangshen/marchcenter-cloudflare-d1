import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deletePlatformStudent,
    executePlatformJump,
    planPlatformJump
} from '../../../server/utils/platformJumpDispatcher.js';

const directConfig = {
    method: 'direct',
    officialBaseUrl: 'https://example.invalid/entry',
    officialBaseUrlConfirmed: true
};

test('dispatcher always selects the official executor', async () => {
    const calls = [];
    const output = await executePlatformJump(directConfig, {}, {
        urlValidator: async () => calls.push('validate'),
        officialExecutor: async () => { calls.push('official'); return 'OFFICIAL'; }
    });
    assert.equal(output, 'OFFICIAL');
    assert.deepEqual(calls, ['validate', 'official']);
});

test('unsupported platform is NOT_IMPLEMENTED', async () => {
    await assert.rejects(executePlatformJump({
        method: 'unknown', officialBaseUrl: 'https://example.invalid', officialBaseUrlConfirmed: true
    }, {}, {
        urlValidator: async () => undefined
    }), { code: 'OFFICIAL_JUMP_NOT_IMPLEMENTED' });
});

test('official failure is returned after exactly one high-level execution', async () => {
    let officialCalls = 0;
    await assert.rejects(executePlatformJump({
        method: 'java', officialBaseUrl: 'https://example.invalid/system', officialBaseUrlConfirmed: true
    }, { user: { id: '1', username: 'u' } }, {
        urlValidator: async () => undefined,
        officialExecutor: async () => {
            officialCalls += 1;
            throw Object.assign(new Error('official failed'), { code: 'REMOTE_FAILED' });
        },
        officialDependencies: { credentialsProvider: { getCredentials: async () => ({}) } }
    }), /official failed/);
    assert.equal(officialCalls, 1);
});

test('URL validation runs before adapter and SSRF rejection makes zero adapter calls', async () => {
    let calls = 0;
    await assert.rejects(executePlatformJump({
        method: 'java', officialBaseUrl: 'http://169.254.169.254/internal', officialBaseUrlConfirmed: true
    }, { user: { id: '1', username: 'u' } }, {
        urlValidator: async () => { throw Object.assign(new Error('SSRF rejected'), { code: 'SSRF_REJECTED' }); },
        officialExecutor: async () => { calls += 1; },
        officialDependencies: { credentialsProvider: { getCredentials: async () => ({}) } }
    }), /SSRF rejected/);
    assert.equal(calls, 0);
});

test('planPlatformJump is pure and reports the fixed official profile', () => {
    const plan = planPlatformJump(directConfig, {});
    assert.equal(plan.platform, 'direct');
    assert.equal(plan.serviceName, 'jump');
    assert.deepEqual(plan.expectedSteps, ['validateUrl', 'returnDirectUrl']);
});

test('student deletion uses exactly one official adapter call', async () => {
    const calls = [];
    const context = { cardUrl: 'https://example.invalid/system', user: { id: '1', username: 'u' } };
    const config = {
        method: 'java', officialBaseUrl: context.cardUrl,
        officialBaseUrlConfirmed: true, allowHttp: false
    };
    await assert.rejects(deletePlatformStudent(config, context, 'student-2', {
        urlValidator: async () => calls.push('validate'),
        officialDelete: async () => { calls.push('official'); throw new Error('official delete failed'); },
        officialDependencies: { credentialsProvider: { getCredentials: async () => ({}) } }
    }), /official delete failed/);
    assert.deepEqual(calls, ['validate', 'official']);
});
