import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CANARY_CONFIRMATION_WORD,
    CANARY_PHASES,
    CANARY_STEP_CONFIRMATION_WORD,
    buildCanaryRollbackPlan,
    createCanaryTargetPolicy,
    createCanaryFetch,
    createMemoryCanaryAuditSink,
    createOfficialCanaryPlan,
    createOfficialCanaryRunner,
    fingerprintCanaryPlan
} from '../../../server/utils/officialCompat/canary/index.js';

function specification(overrides = {}) {
    return {
        configId: 901,
        method: 'java',
        officialBaseUrl: 'http://127.0.0.1:9289/DS50108',
        allowedHostname: '127.0.0.1',
        allowedPort: 9289,
        approvedResolvedAddresses: ['127.0.0.1'],
        privateTargetExplicitlyApproved: true,
        cardUrl: 'http://127.0.0.1:9289/DS50108',
        testStudentAccount: 'canary-student',
        testTeacherAccount: 'canary-teacher',
        testStudentList: ['canary-student', 'canary-student-2'],
        testClassName: 'CANARY-ONLY-CLASS',
        testUserId: '9223372036854775807',
        classType: 1,
        trainOrExam: 'train',
        credentialsConfigured: true,
        isolatedTestEnvironmentConfirmed: true,
        snapshotOrCleanupReady: true,
        confirmationWord: CANARY_CONFIRMATION_WORD,
        ...overrides
    };
}

function lease() {
    let active = false;
    return {
        get active() { return active; },
        async acquire() {
            if (active) throw new Error('lease already active');
            active = true;
            return async () => { active = false; };
        }
    };
}

function runnerOptions(executeStep, overrides = {}) {
    const currentSpecification = overrides.currentSpecification || specification();
    return {
        executeStep,
        fetchImplementation: async () => new Response('ok'),
        resolveHostname: async () => ['127.0.0.1'],
        auditSink: createMemoryCanaryAuditSink(),
        leaseProvider: lease(),
        authorizationProvider: {
            async consume({ authorization, specification: current }) {
                const fingerprint = await fingerprintCanaryPlan(current);
                if (authorization?.fingerprint !== fingerprint) throw new Error('authorization mismatch');
                return { runId: authorization.runId, fingerprint };
            }
        },
        loadCurrentSpecification: async () => currentSpecification,
        clock: () => 1_700_000_000_000,
        ...overrides
    };
}

async function authorization(input = specification()) {
    return Object.freeze({
        token: 'test-one-time-authorization',
        runId: 'canary-run-001',
        fingerprint: await fingerprintCanaryPlan(input),
        createdAt: 1_700_000_000_000,
        expiresAt: 1_700_000_300_000
    });
}

async function accept(runner, phase) {
    return runner.confirmPhase({
        phase,
        confirmationWord: CANARY_STEP_CONFIRMATION_WORD,
        humanResult: { accepted: true, note: '人工确认测试环境状态正确' }
    });
}

test('preflight plan is pure, fingerprinted, redacted, and does not require the execution confirmation word', async () => {
    const input = specification({ confirmationWord: undefined });
    const plan = await createOfficialCanaryPlan(input);
    assert.equal(plan.configId, 901);
    assert.equal(plan.serviceName, 'NewTrainingInterfaceUtilService');
    assert.deepEqual(plan.target, { hostname: '127.0.0.1', port: 9289, path: '/DS50108' });
    assert.equal(plan.loginName, 'c***t');
    assert.match(plan.fingerprint, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(plan), /RUN_OFFICIAL_CANARY|password|platformToken|ticket/i);
});

test('plan fingerprint is stable for IP ordering and changes for every execution-relevant field', async () => {
    const base = specification();
    const baseline = await fingerprintCanaryPlan(base);
    const reordered = await fingerprintCanaryPlan({
        ...base,
        approvedResolvedAddresses: ['2001:db8::1', '127.0.0.1']
    });
    const reorderedAgain = await fingerprintCanaryPlan({
        ...base,
        approvedResolvedAddresses: ['127.0.0.1', '2001:db8::1']
    });
    assert.equal(reordered, reorderedAgain);
    const variants = [
        { configId: 902 },
        { method: 'net' },
        { officialBaseUrl: 'http://127.0.0.1:9290/DS50108', allowedPort: 9290 },
        { officialBaseUrl: 'http://127.0.0.2:9289/DS50108', allowedHostname: '127.0.0.2', approvedResolvedAddresses: ['127.0.0.2'] },
        { officialBaseUrl: 'http://127.0.0.1:9289/OTHER', cardUrl: 'http://127.0.0.1:9289/OTHER' },
        { approvedResolvedAddresses: ['127.0.0.1', '2001:db8::1'] },
        { privateTargetExplicitlyApproved: false },
        { testStudentAccount: 'different-student' },
        { testTeacherAccount: 'different-teacher' },
        { testStudentList: ['canary-student-2', 'canary-student'] },
        { testClassName: 'DIFFERENT-CLASS' },
        { testUserId: '1' },
        { classType: 2 },
        { trainOrExam: 'exam' }
    ];
    for (const changes of variants) {
        assert.notEqual(await fingerprintCanaryPlan({ ...base, ...changes }), baseline);
    }
});

test('execution gate rejects every missing safety assertion before executeStep', async t => {
    for (const field of [
        'allowedHostname', 'allowedPort', 'testStudentAccount', 'testTeacherAccount', 'testClassName',
        'classType', 'trainOrExam', 'credentialsConfigured', 'isolatedTestEnvironmentConfirmed',
        'snapshotOrCleanupReady'
    ]) {
        await t.test(field, async () => {
            let calls = 0;
            const runner = createOfficialCanaryRunner(runnerOptions(async () => { calls += 1; }));
            const bad = specification();
            if (field === 'allowedPort') bad[field] = undefined;
            else if (['credentialsConfigured', 'isolatedTestEnvironmentConfirmed', 'snapshotOrCleanupReady'].includes(field)) bad[field] = false;
            else bad[field] = undefined;
            const issued = await authorization();
            await assert.rejects(() => runner.start(bad, issued));
            assert.equal(calls, 0);
        });
    }
});

test('RUN_OFFICIAL_CANARY text alone cannot start without a one-time authorization', async () => {
    let calls = 0;
    const runner = createOfficialCanaryRunner(runnerOptions(async () => { calls += 1; }));
    await assert.rejects(() => runner.start(specification()), /authorization/);
    assert.equal(calls, 0);
});

test('target policy enforces exact host, port, context, DNS addresses, private approval, and blocks redirects', async () => {
    const spec = specification();
    const policy = createCanaryTargetPolicy(spec, { resolveHostname: async () => ['127.0.0.1'] });
    await policy.assertRequest('http://127.0.0.1:9289/DS50108/open/tokenInfo');
    await assert.rejects(() => policy.assertRequest('http://127.0.0.1:9290/DS50108/open/tokenInfo'), /白名单/);
    await assert.rejects(() => policy.assertRequest('http://127.0.0.1:9289/OTHER/open/tokenInfo'), /白名单/);
    const rebound = createCanaryTargetPolicy(spec, { resolveHostname: async () => ['127.0.0.2'] });
    await assert.rejects(() => rebound.assertRequest(spec.officialBaseUrl), /DNS/);
    const emptyDns = createCanaryTargetPolicy(spec, { resolveHostname: async () => [] });
    await assert.rejects(() => emptyDns.assertRequest(spec.officialBaseUrl), /DNS/);
    assert.throws(() => createCanaryTargetPolicy(specification({ privateTargetExplicitlyApproved: false }), {
        resolveHostname: async () => ['127.0.0.1']
    }), /明确批准/);
    assert.throws(() => createCanaryTargetPolicy(specification({
        officialBaseUrl: 'http://169.254.169.254:9289/DS50108',
        allowedHostname: '169.254.169.254',
        approvedResolvedAddresses: ['169.254.169.254']
    }), { resolveHostname: async () => ['169.254.169.254'] }), /metadata/);
    const approvedLinkLocalSpec = specification({
        officialBaseUrl: 'http://169.254.10.20:9289/DS50108',
        allowedHostname: '169.254.10.20',
        approvedResolvedAddresses: ['169.254.10.20']
    });
    await createCanaryTargetPolicy(approvedLinkLocalSpec, {
        resolveHostname: async () => ['169.254.10.20']
    }).assertBaseTarget();
    let redirected = 0;
    const safeFetch = createCanaryFetch({
        policy,
        fetchImplementation: async () => {
            redirected += 1;
            return new Response('', { status: 302, headers: { location: 'http://127.0.0.2/' } });
        }
    });
    await assert.rejects(() => safeFetch(`${spec.officialBaseUrl}/open/tokenInfo`), /重定向/);
    assert.equal(redirected, 1);
});

test('every child request rechecks all A/AAAA results and DNS changes stop the run', async () => {
    const domainSpec = specification({
        officialBaseUrl: 'https://canary.example.invalid:9443/DS50108',
        allowedHostname: 'canary.example.invalid',
        allowedPort: 9443,
        approvedResolvedAddresses: ['2001:db8::10', '192.0.2.10']
    });
    let resolutionCalls = 0;
    const stablePolicy = createCanaryTargetPolicy(domainSpec, {
        resolveHostname: async () => {
            resolutionCalls += 1;
            return resolutionCalls % 2
                ? ['192.0.2.10', '2001:db8::10']
                : ['2001:db8::10', '192.0.2.10'];
        }
    });
    const seenUrls = [];
    const safeFetch = createCanaryFetch({
        policy: stablePolicy,
        fetchImplementation: async (input, init) => {
            seenUrls.push({ url: String(input), redirect: init.redirect, headers: init.headers });
            return new Response('ok');
        }
    });
    await safeFetch(`${domainSpec.officialBaseUrl}/open/tokenInfo`, { method: 'POST' });
    await safeFetch(`${domainSpec.officialBaseUrl}/open/getUserName`, { method: 'POST' });
    assert.equal(resolutionCalls, 2);
    assert.equal(stablePolicy.getResolutionCheckCount(), 2);
    assert.deepEqual(seenUrls.map(item => item.url), [
        `${domainSpec.officialBaseUrl}/open/tokenInfo`,
        `${domainSpec.officialBaseUrl}/open/getUserName`
    ]);
    assert.ok(seenUrls.every(item => item.redirect === 'manual'));
    assert.ok(seenUrls.every(item => item.headers === undefined));

    const mixedPolicy = createCanaryTargetPolicy(domainSpec, {
        resolveHostname: async () => ['192.0.2.10', '203.0.113.99']
    });
    await assert.rejects(() => mixedPolicy.assertBaseTarget(), /未批准/);

    let changeCall = 0;
    const changedPolicy = createCanaryTargetPolicy({
        ...domainSpec,
        approvedResolvedAddresses: ['192.0.2.10', '192.0.2.11']
    }, {
        resolveHostname: async () => [changeCall++ === 0 ? '192.0.2.10' : '192.0.2.11']
    });
    await changedPolicy.assertBaseTarget();
    await assert.rejects(
        () => changedPolicy.assertRequest(`${domainSpec.officialBaseUrl}/open/tokenInfo`),
        error => error.code === 'OFFICIAL_CANARY_DNS_CHANGED'
    );
});

test('canary fetch preserves HTTPS hostname and rejects Host or resolveOverride rewrites', async () => {
    const spec = specification({
        officialBaseUrl: 'https://canary.example.invalid:9443/DS50108',
        allowedHostname: 'canary.example.invalid',
        allowedPort: 9443,
        approvedResolvedAddresses: ['192.0.2.10']
    });
    const policy = createCanaryTargetPolicy(spec, { resolveHostname: async () => ['192.0.2.10'] });
    let captured;
    const safeFetch = createCanaryFetch({
        policy,
        fetchImplementation: async (input, init) => {
            captured = { input: String(input), init };
            return new Response('ok');
        }
    });
    const url = `${spec.officialBaseUrl}/open/tokenInfo`;
    await safeFetch(url, { method: 'POST' });
    assert.equal(captured.input, url);
    assert.equal(new URL(captured.input).hostname, 'canary.example.invalid');
    assert.equal(captured.init.redirect, 'manual');
    await assert.rejects(() => safeFetch(url, { headers: { Host: '192.0.2.10' } }), /Host Header/);
    await assert.rejects(() => safeFetch(url, { cf: { resolveOverride: 'other.example.invalid' } }), /resolveOverride/);
});

test('stateful runner locks first/second student and teacher, 10011 recovery, and exactly two concurrent calls', async () => {
    const remote = { group: false, students: new Set(), teacher: false, calls: [], tokenAttempt: 0 };
    const executeStep = async context => {
        const record = async (operationName, created = false, code = 10000) => {
            remote.calls.push(`${context.phase}:${operationName}`);
            await context.observeOperation({ operationName, created, code, success: code === 10000 });
        };
        if (context.phase.startsWith('student')) {
            await record('IsGroupExisted');
            if (!remote.group) { remote.group = true; await record('AddTrainGroup', true); }
            await record('IsStuExisted');
            if (!remote.students.has('canary-student')) {
                remote.students.add('canary-student'); await record('AddStudent', true);
            }
        } else if (context.phase.startsWith('teacher')) {
            await record('IsGroupExisted');
            await record('IsTeacherExisted');
            if (!remote.teacher) { remote.teacher = true; await record('AddTeacher', true); }
            await record('IsStuExisted');
            if (!remote.students.has('canary-student-2')) {
                remote.students.add('canary-student-2'); await record('AddStudent', true);
            }
        } else if (context.phase === 'java-token-recovery') {
            remote.tokenAttempt += 1;
            await record('tokenInfo'); await record('getUserName', false, 10011);
            remote.tokenAttempt += 1;
            await record('tokenInfo'); await record('getUserName'); await record('trainingExamPaper');
        } else if (context.phase === 'concurrency-two') {
            await record('IsGroupExisted'); await record('IsStuExisted');
        }
        await context.onStage('prepare_entry', 'ready');
        await context.onStage('prepare_entry', 'duplicate must be ignored');
        return { success: true, code: 10000, redirectUrlGenerated: true };
    };
    const opts = runnerOptions(executeStep);
    const runner = createOfficialCanaryRunner(opts);
    await runner.start(specification(), await authorization());
    for (const phase of CANARY_PHASES) {
        const result = await runner.runPhase(phase);
        assert.equal(result.success, true);
        await accept(runner, phase);
    }
    assert.equal(runner.getState().status, 'completed');
    assert.equal(remote.students.size, 2);
    assert.equal(remote.teacher, true);
    assert.equal(remote.tokenAttempt, 2);
    assert.equal(remote.calls.filter(item => item.startsWith('concurrency-two:')).length, 4);
    assert.equal(opts.leaseProvider.active, false);
    const stageRecords = opts.auditSink.records.filter(record => record.event === 'stage');
    assert.equal(stageRecords.length, 6);
});

test('ordinary failure stops immediately, releases lease, and cannot enter another execution path', async () => {
    let officialCalls = 0;
    const opts = runnerOptions(async () => {
        officialCalls += 1;
        throw Object.assign(new Error('ordinary failure'), { code: 'REMOTE_FAILURE' });
    });
    const runner = createOfficialCanaryRunner(opts);
    await runner.start(specification(), await authorization());
    await runner.runPhase('connectivity');
    await accept(runner, 'connectivity');
    await assert.rejects(() => runner.runPhase('student-first'), /ordinary failure/);
    assert.equal(runner.getState().status, 'failed');
    assert.equal(officialCalls, 1);
    assert.equal(opts.leaseProvider.active, false);
    await assert.rejects(() => runner.runPhase('student-second'));
});

test('runner rechecks the current plan fingerprint before every phase', async () => {
    const original = specification();
    let current = original;
    let executeCalls = 0;
    const runner = createOfficialCanaryRunner(runnerOptions(async () => {
        executeCalls += 1;
        return { success: true, code: 10000 };
    }, {
        currentSpecification: original,
        loadCurrentSpecification: async () => current
    }));
    await runner.start(original, await authorization(original));
    current = specification({ testClassName: 'PLAN-CHANGED-AFTER-AUTHORIZATION' });
    await assert.rejects(
        () => runner.runPhase('connectivity'),
        error => error.code === 'OFFICIAL_CANARY_PLAN_CHANGED'
    );
    assert.equal(executeCalls, 0);
    assert.equal(runner.getState().status, 'failed');
});

test('manual-confirmation wait heartbeat renews lease and rechecks the plan without network', async () => {
    const input = specification();
    let renewals = 0;
    let dnsCalls = 0;
    const leaseProvider = {
        async acquire() {
            return {
                async renew() { renewals += 1; },
                async release() { return true; }
            };
        }
    };
    const runner = createOfficialCanaryRunner(runnerOptions(async () => ({ success: true, code: 10000 }), {
        leaseProvider,
        currentSpecification: input,
        loadCurrentSpecification: async () => input,
        resolveHostname: async () => { dnsCalls += 1; return ['127.0.0.1']; }
    }));
    await runner.start(input, await authorization(input));
    await runner.runPhase('connectivity');
    const dnsAfterPhase = dnsCalls;
    await runner.heartbeat();
    await runner.heartbeat();
    assert.equal(dnsCalls, dnsAfterPhase);
    assert.ok(renewals >= 4);
});

test('runner supplies only the canary fetch and every JAVA child request rechecks DNS', async () => {
    const input = specification();
    let dnsCalls = 0;
    let rawFetchCalls = 0;
    const runner = createOfficialCanaryRunner(runnerOptions(async context => {
        await context.fetchImplementation(`${input.officialBaseUrl}/open/tokenInfo`, { method: 'POST' });
        await context.fetchImplementation(`${input.officialBaseUrl}/open/getUserName`, { method: 'POST' });
        await context.fetchImplementation(`${input.officialBaseUrl}/open/trainingExamPaper`, { method: 'POST' });
        return { success: true, code: 10000 };
    }, {
        currentSpecification: input,
        loadCurrentSpecification: async () => input,
        resolveHostname: async () => { dnsCalls += 1; return ['127.0.0.1']; },
        fetchImplementation: async () => { rawFetchCalls += 1; return new Response('ok'); }
    }));
    await runner.start(input, await authorization(input));
    await runner.runPhase('connectivity'); await accept(runner, 'connectivity');
    const beforeStudent = dnsCalls;
    await runner.runPhase('student-first');
    assert.equal(dnsCalls - beforeStudent, 4);
    assert.equal(rawFetchCalls, 3);
});

test('concurrency stops when a non-idempotent remote creates twice', async () => {
    const runner = createOfficialCanaryRunner(runnerOptions(async context => {
        if (context.phase === 'concurrency-two') {
            await context.observeOperation({ operationName: 'AddStudent', created: true, code: 10000, success: true });
        }
        return { success: true, code: 10000 };
    }));
    await runner.start(specification(), await authorization());
    for (const phase of CANARY_PHASES.slice(0, -1)) {
        await runner.runPhase(phase); await accept(runner, phase);
    }
    await assert.rejects(() => runner.runPhase('concurrency-two'), /重复创建/);
    assert.equal(runner.getState().status, 'failed');
});

test('audit sink omits secrets, raw bodies, tickets, and duplicate state writes', async () => {
    const sink = createMemoryCanaryAuditSink();
    const opts = runnerOptions(async context => {
        await context.observeOperation({ operationName: 'getUserName', code: 10000, success: true });
        assert.equal(await context.recordStateWrite('account-ready', true), true);
        assert.equal(await context.recordStateWrite('account-ready', true), false);
        return { success: true, code: 10000, message: 'secret-password token-value ticket-value' };
    }, {
        auditSink: sink,
        secretValues: ['secret-password', 'token-value', 'ticket-value']
    });
    const runner = createOfficialCanaryRunner(opts);
    await runner.start(specification(), await authorization());
    await runner.runPhase('connectivity'); await accept(runner, 'connectivity');
    await runner.runPhase('student-first');
    const serialized = JSON.stringify(sink.records);
    assert.doesNotMatch(serialized, /secret-password|token-value|ticket-value|platformToken|authorization/i);
    assert.equal(sink.records.filter(item => item.event === 'state-write').length, 1);
});

test('rollback plan is manual and scoped to exactly one test config', () => {
    const rollback = buildCanaryRollbackPlan(specification({ confirmationWord: undefined }));
    assert.equal(rollback.configId, 901);
    assert.deepEqual(rollback.automaticActions, []);
    assert.ok(rollback.marchCenter.every(action => action.configId === 901));
    assert.match(rollback.warning, /不执行/);
});
