import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
    CANARY_CONFIRMATION_WORD,
    CANARY_PHASES,
    CANARY_STEP_CONFIRMATION_WORD,
    createD1CanaryLeaseProvider,
    createD1CanaryAuthorizationProvider,
    createMemoryCanaryAuditSink,
    createOfficialCanaryRunner
} from '../../server/utils/officialCompat/canary/index.js';
import { createProductionHarness, officialConfig } from './helpers/productionHarness.mjs';

let harness;
before(async () => { harness = await createProductionHarness(); });
after(async () => { await harness?.dispose(); });

test('complete canary runner drives the Miniflare production route against one stateful loopback SOAP platform', async () => {
    await harness.reset();
    const officialBaseUrl = 'http://127.0.0.1:9289/DS50108';
    const configId = await harness.seedConfig(officialConfig('net', { officialBaseUrl }));
    const competitionId = await harness.seedCompetition({
        configId,
        method: 'net',
        url: officialBaseUrl,
        classType: 1
    });
    const auditSink = createMemoryCanaryAuditSink();
    const pool = {
        async query(sql, values = []) {
            const statement = harness.database.prepare(sql).bind(...values);
            if (/^SELECT/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
                const result = await statement.all();
                return [result.results];
            }
            const result = await statement.run();
            return [{ meta: result.meta }];
        }
    };
    let leaseSequence = 0;
    const leaseProvider = createD1CanaryLeaseProvider({
        pool,
        randomUUID: () => `miniflare-canary-lease-owner-${++leaseSequence}`
    });
    const authorizationProvider = createD1CanaryAuthorizationProvider({
        pool,
        randomUUID: () => 'miniflare-canary-run',
        randomBytes: () => new Uint8Array(32).fill(7)
    });
    const canarySpecification = {
        configId,
        method: 'net',
        officialBaseUrl,
        allowedHostname: '127.0.0.1',
        allowedPort: 9289,
        approvedResolvedAddresses: ['127.0.0.1'],
        privateTargetExplicitlyApproved: true,
        cardUrl: officialBaseUrl,
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
        confirmationWord: CANARY_CONFIRMATION_WORD
    };
    const executeStep = async context => {
        const beforeCount = harness.platform.state.requests.length;
        const response = await harness.api('/api/sso/execute', {
            body: {
                competitionId,
                context: {
                    loginRole: context.phase.startsWith('teacher') ? 'teacher' : 'student',
                    className: 'CANARY-ONLY-CLASS',
                    loginName: context.phase.startsWith('teacher') ? 'canary-teacher' : 'canary-student',
                    teacherUserName: 'canary-teacher',
                    studentList: ['canary-student', 'canary-student-2'],
                    userId: '9223372036854775807',
                    userName: 'Canary User',
                    classType: 1,
                    trainOrExam: 'train'
                }
            }
        });
        const requests = harness.platform.state.requests.slice(beforeCount);
        for (const request of requests) {
            await context.observeOperation({
                operationName: request.operationName,
                code: response.status === 200 ? 10000 : response.status,
                success: response.status === 200,
                created: /^Add/.test(request.operationName)
            });
        }
        return {
            success: response.status === 200,
            code: response.status === 200 ? 10000 : response.status,
            message: response.data?.message,
            redirectUrlGenerated: typeof response.data?.redirectUrl === 'string'
        };
    };
    const runner = createOfficialCanaryRunner({
        executeStep,
        fetchImplementation: harness.platform.fetch,
        resolveHostname: async () => ['127.0.0.1'],
        auditSink,
        leaseProvider,
        authorizationProvider,
        loadCurrentSpecification: async () => canarySpecification
    });
    const authorization = await authorizationProvider.issue(canarySpecification);
    await runner.start(canarySpecification, authorization);
    await assert.rejects(
        () => leaseProvider.acquire({ key: 'OFFICIAL_CANARY_SINGLE_TARGET', runId: 'competing-run' }),
        error => error.code === 'OFFICIAL_CANARY_LEASE_CONFLICT'
    );
    const phaseResults = new Map();
    for (const phase of CANARY_PHASES) {
        phaseResults.set(phase, await runner.runPhase(phase));
        await runner.confirmPhase({
            phase,
            confirmationWord: CANARY_STEP_CONFIRMATION_WORD,
            humanResult: { accepted: true, note: 'stateful Miniflare mock verified' }
        });
    }
    assert.equal(runner.getState().status, 'completed');
    assert.deepEqual(await harness.rows("SELECT * FROM d1_locks WHERE name = 'OFFICIAL_CANARY_SINGLE_TARGET'"), []);
    assert.ok(phaseResults.get('student-first').createdOperations.includes('AddTrainGroup'));
    assert.ok(phaseResults.get('student-first').createdOperations.includes('AddStudent'));
    assert.deepEqual(phaseResults.get('student-second').createdOperations, []);
    assert.ok(phaseResults.get('teacher-first').createdOperations.includes('AddTeacher'));
    assert.deepEqual(phaseResults.get('teacher-second').createdOperations, []);
    assert.equal(harness.platform.state.groups.size, 1);
    assert.equal(harness.platform.state.teachers.size, 1);
    assert.equal(harness.platform.state.students.size, 2);
    const statuses = await harness.rows('SELECT * FROM user_platform_account_status');
    assert.ok(statuses.length >= 1);
    assert.doesNotMatch(JSON.stringify(auditSink.records), /soap-password|token-password|platformToken|ticket/i);
});
