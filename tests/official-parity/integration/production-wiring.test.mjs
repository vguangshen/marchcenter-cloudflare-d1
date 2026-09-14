import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    executePlatformJump,
    planPlatformJump,
    preflightPlatformJump
} from '../../../server/utils/platformJumpDispatcher.js';
import { validateConfirmedOfficialBaseUrl } from '../../../server/utils/officialCompat/officialJumpConfig.js';
import {
    preflightOfficialPlatform,
    validateOfficialJumpConfiguration
} from '../../../server/utils/officialCompat/officialJumpPreflight.js';
import { createOfficialDependencyFactory } from '../../../server/utils/officialCompat/officialDependencyFactory.js';

const BASE = 'http://127.0.0.1:9289/DS50108';
const USER = Object.freeze({ id: '9223372036854775807', username: '用户 & 1', name: '姓名 <A>' });

function officialConfig(overrides = {}) {
    return {
        officialBaseUrlConfirmed: true,
        method: 'java',
        officialBaseUrl: BASE,
        tokenNumber: 'fixture-number',
        tokenPassword: 'fixture-password',
        ...overrides
    };
}

function officialDependencies(overrides = {}) {
    return createOfficialDependencyFactory({
        fetchImplementation: async () => { throw new Error('network forbidden'); },
        credentialsProvider: { async getCredentials() { return { tokenNum: 'n', password: 'p' }; } },
        logger: { info() {}, error() {} },
        trainingEntrance: {
            async executeNew() {
                return { code: 10000, succ: true, message: '成功', data: 'u=fixture', raw: '{}' };
            }
        },
        ...overrides
    });
}

test('missing officialBaseUrl fails before URL or credential checks', async () => {
    let calls = 0;
    await assert.rejects(preflightOfficialPlatform(officialConfig({ officialBaseUrl: undefined }), { user: USER }, {
        urlValidator: async () => { calls += 1; },
        credentialsProvider: { getCredentials: async () => { calls += 1; } }
    }), { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' });
    assert.equal(calls, 0);
});

for (const [label, value] of [
    ['full WSDL', `${BASE}/NormWebService.asmx`],
    ['trailing slash', `${BASE}/`],
    ['open path', `${BASE}/open`],
    ['query', `${BASE}?wsdl`],
    ['complete method', `${BASE}/trainingExamPaper`]
]) {
    test(`officialBaseUrl rejects ${label} before requests`, () => {
        assert.throws(() => validateConfirmedOfficialBaseUrl(value), { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' });
    });
}

test('valid officialBaseUrl preserves project context path', () => {
    assert.equal(validateConfirmedOfficialBaseUrl(BASE), BASE);
});

test('official preflight reports exact service and sanitized target', async () => {
    let urlChecks = 0; let credentialChecks = 0;
    const report = await preflightOfficialPlatform(officialConfig(), { user: USER }, {
        urlValidator: async () => { urlChecks += 1; },
        credentialsProvider: { getCredentials: async () => { credentialChecks += 1; return {}; } }
    });
    assert.deepEqual(report.target, { protocol: 'http:', host: '127.0.0.1:9289', path: '/DS50108' });
    assert.equal(report.serviceName, 'NewTrainingInterfaceUtilService');
    assert.equal(urlChecks, 1); assert.equal(credentialChecks, 1);
    assert.doesNotMatch(JSON.stringify(report), /fixture-password|fixture-number|platformToken|ticket/i);
});

test('official teacher preflight reports the teacherIndex URL rule', () => {
    const report = validateOfficialJumpConfiguration(officialConfig(), {
        user: USER,
        loginRole: 'teacher'
    });
    assert.equal(report.commonMethod, 'commonReturnTeacherBaseInfo');
    assert.equal(report.urlRule, 'officialBaseUrl + /open/teacherIndex?needTheoryScore=1& + result.data');
});

test('official SOAP teacher preflight reports the fixed theory-score suffix', () => {
    const report = validateOfficialJumpConfiguration({
        ...officialConfig(), method: 'commerce', soapUsername: 'u', soapPassword: 'p'
    }, { user: USER, loginRole: 'teacher' });
    assert.equal(report.commonMethod, 'commonReturnTeacherBaseInfo');
    assert.equal(
        report.urlRule,
        'officialBaseUrl + /Login.aspx?type=itmc&data= + result.data + &needTheoryScore=1'
    );
});

test('preflight preserves 0 false null and empty string distinctions', () => {
    const report = validateOfficialJumpConfiguration(officialConfig({
        maxRunYear: 0, autoDeal: false, classType: null, flag: ''
    }), { user: USER, startTime: 0, endTime: null });
    assert.deepEqual(report.preserves, { zero: true, false: true, null: true, emptyString: true });
});

test('maximum Java long remains accepted as a decimal string', () => {
    assert.doesNotThrow(() => validateOfficialJumpConfiguration(officialConfig(), { user: USER }));
});

test('unsafe numeric long is rejected before network', () => {
    assert.throws(() => validateOfficialJumpConfiguration(officialConfig(), {
        user: { ...USER, id: 9223372036854776000 }
    }), { code: 'OFFICIAL_JUMP_LONG_UNSAFE' });
});

test('out-of-range decimal Java long is rejected before network', () => {
    assert.throws(() => validateOfficialJumpConfiguration(officialConfig(), {
        user: { ...USER, id: '9223372036854775808' }
    }), { code: 'OFFICIAL_JUMP_LONG_OUT_OF_RANGE' });
});

test('official dispatcher rejects SSRF before executor and network', async () => {
    let executorCalls = 0; let networkCalls = 0;
    const deps = officialDependencies({ fetchImplementation: async () => { networkCalls += 1; } });
    await assert.rejects(executePlatformJump(officialConfig(), { user: USER }, {
        urlValidator: async () => { throw Object.assign(new Error('blocked'), { code: 'SSRF_REJECTED' }); },
        officialExecutor: async () => { executorCalls += 1; },
        officialDependencies: deps
    }), { code: 'SSRF_REJECTED' });
    assert.equal(executorCalls, 0); assert.equal(networkCalls, 0);
});

test('official failure stops after exactly one high-level execution', async () => {
    let officialCalls = 0;
    await assert.rejects(executePlatformJump(officialConfig(), { user: USER }, {
        urlValidator: async () => undefined,
        officialDependencies: officialDependencies(),
        officialExecutor: async () => {
            officialCalls += 1;
            throw new Error('official failed');
        }
    }), /official failed/);
    assert.equal(officialCalls, 1);
});

test('JAVA execution forwards readiness state for its own fast path', async () => {
    const context = { user: USER, accountWasReady: true };
    const result = await executePlatformJump(officialConfig(), context, {
        urlValidator: async () => undefined,
        officialDependencies: officialDependencies()
    });
    assert.equal(result, `${BASE}/open/enterIndex?u=fixture`);
});

test('ready SOAP execution validates its target but skips credential lookup and remote requests', async () => {
    let urlChecks = 0;
    let credentialChecks = 0;
    const result = await executePlatformJump(officialConfig({
        method: 'commerce',
        soapUsername: 'stored',
        soapPassword: 'stored'
    }), { user: USER, loginRole: 'teacher', accountWasReady: true }, {
        urlValidator: async () => { urlChecks += 1; },
        officialDependencies: officialDependencies({
            credentialsProvider: {
                async getCredentials() {
                    credentialChecks += 1;
                    throw new Error('ready fast path must not read credentials');
                }
            }
        })
    });
    assert.match(result, new RegExp(`^${BASE}/Login\\.aspx\\?type=itmc&data=[A-F0-9]+&needTheoryScore=1$`));
    assert.equal(urlChecks, 1);
    assert.equal(credentialChecks, 0);
});

test('official unknown result does not report prepare_entry readiness', async () => {
    const stages = [];
    const deps = officialDependencies({
        trainingEntrance: { async executeNew() { return { code: 10000, succ: true, data: null }; } }
    });
    await assert.rejects(executePlatformJump(officialConfig(), {
        user: USER, onStage: stage => stages.push(stage)
    }, { urlValidator: async () => undefined, officialDependencies: deps }), {
        code: 'OFFICIAL_JUMP_DATA_MISSING'
    });
    assert.equal(stages.filter(stage => stage === 'check_class').length, 0);
    assert.equal(stages.filter(stage => stage === 'create_account').length, 0);
    assert.equal(stages.includes('prepare_entry'), false);
});

test('official retries inside TrainingEntrance cannot duplicate outer state stages', async () => {
    const stages = [];
    const deps = officialDependencies({
        trainingEntrance: {
            async executeNew() {
                // The real TrainingEntrance owns all 10011 retries within this one call.
                return { code: 10000, succ: true, data: 'u=after-retry' };
            }
        }
    });
    await executePlatformJump(officialConfig(), { user: USER, onStage: stage => stages.push(stage) }, {
        urlValidator: async () => undefined, officialDependencies: deps
    });
    assert.equal(stages.filter(stage => stage === 'create_account').length, 1);
    assert.equal(stages.filter(stage => stage === 'prepare_entry').length, 1);
});

test('one request-scoped dependency graph reuses exactly one TokenStore instance', async () => {
    const seen = [];
    const deps = officialDependencies({
        trainingEntrance: {
            async executeNew(request) {
                seen.push(request.adapterOptions.tokenStore, request.adapterOptions.tokenStore);
                return { code: 10000, succ: true, data: 'u=ok' };
            }
        }
    });
    await executePlatformJump(officialConfig(), { user: USER }, {
        urlValidator: async () => undefined, officialDependencies: deps
    });
    assert.equal(seen[0], deps.tokenStore);
    assert.equal(seen[0], seen[1]);
});

test('direct preflight and planning perform zero network, credentials, or ticket work', async () => {
    let sideEffects = 0;
    const config = officialConfig({ method: 'direct', officialBaseUrl: `${BASE}/entry` });
    const report = await preflightPlatformJump(config, {}, {
        urlValidator: async () => undefined,
        officialDependencies: officialDependencies({
            fetchImplementation: async () => { sideEffects += 1; },
            credentialsProvider: { getCredentials: async () => { sideEffects += 1; } }
        })
    });
    const plan = planPlatformJump(config, {});
    assert.equal(report.method, 'direct'); assert.equal(plan.platform, 'direct'); assert.equal(sideEffects, 0);
});

test('official error metadata and preflight output never expose secrets', async () => {
    const logs = [];
    const deps = officialDependencies({
        logger: { info() {}, error(value) { logs.push(value); } },
        trainingEntrance: { async executeNew() { throw Object.assign(new Error('fixture-password'), { code: 'REMOTE' }); } }
    });
    await assert.rejects(executePlatformJump(officialConfig(), { user: USER }, {
        urlValidator: async () => undefined, officialDependencies: deps
    }));
    assert.doesNotMatch(JSON.stringify(logs), /fixture-password|fixture-number|platformToken|ticket/i);
});

test('production SSO route imports only the official dispatcher and neutral manual target helper', async () => {
    const source = await readFile(new URL('../../../server/routes/sso.js', import.meta.url), 'utf8');
    assert.match(source, /executePlatformJump, preflightPlatformJump[^;]+platformJumpDispatcher\.js/);
    assert.match(source, /buildManualCredentialTarget[^;]+officialCompat\/manualCredentialTarget\.js/);
    assert.match(source, /deletePlatformStudent[^;]+platformJumpDispatcher\.js/);
});

test('ordinary SSO route excludes dedicated canary-only configurations', async () => {
    const source = await readFile(new URL('../../../server/routes/sso.js', import.meta.url), 'utf8');
    assert.match(source, /config\.canaryOnly === true/);
    assert.match(source, /candidate\.canaryOnly !== true/);
    assert.match(source, /专用 canary 配置不能通过普通 SSO 路由执行/);
});
