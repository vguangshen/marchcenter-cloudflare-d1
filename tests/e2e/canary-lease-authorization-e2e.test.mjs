import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { Miniflare } from 'miniflare';
import {
    CANARY_CONFIRMATION_WORD,
    createCanaryAuditRecorder,
    createD1CanaryAuthorizationProvider,
    createD1CanaryLeaseProvider,
    createMemoryCanaryAuditSink,
    createOfficialCanaryRunner
} from '../../server/utils/officialCompat/canary/index.js';

let miniflare;
let database;
let pool;

function specification(overrides = {}) {
    return {
        configId: 701,
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

before(async () => {
    miniflare = new Miniflare({
        modules: true,
        script: 'export default { fetch() { return new Response("ok"); } }',
        compatibilityDate: '2026-07-29',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: `canary-lock-${crypto.randomUUID()}` }
    });
    database = await miniflare.getD1Database('DB');
    await database.exec(`
        CREATE TABLE d1_locks (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE canary_audit_test (id INTEGER PRIMARY KEY AUTOINCREMENT, record_json TEXT NOT NULL);
    `);
    pool = {
        async query(sql, values = []) {
            const statement = database.prepare(sql).bind(...values);
            if (/^SELECT/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
                const result = await statement.all();
                return [result.results];
            }
            const result = await statement.run();
            return [{ affectedRows: Number(result.meta?.changes || 0), meta: result.meta }];
        }
    };
});

after(async () => { await miniflare?.dispose(); });
beforeEach(async () => {
    await database.exec('DELETE FROM d1_locks; DELETE FROM canary_audit_test;');
});

function leaseProvider(clock = () => 1_000) {
    let sequence = 0;
    return createD1CanaryLeaseProvider({
        pool,
        clock,
        leaseMs: 60_000,
        maxStageExecutionMs: 20_000,
        randomUUID: () => `owner-${++sequence}`
    });
}

test('d1_locks lease key is enforced by the D1 primary-key uniqueness constraint', async () => {
    const columns = (await database.prepare('PRAGMA table_info(d1_locks)').all()).results;
    assert.equal(columns.find(column => column.name === 'name')?.pk, 1);
    await database.prepare('INSERT INTO d1_locks (name, owner, expires_at) VALUES (?, ?, ?)')
        .bind('same-key', 'owner-a', 10_000).run();
    await assert.rejects(() => database.prepare(
        'INSERT INTO d1_locks (name, owner, expires_at) VALUES (?, ?, ?)'
    ).bind('same-key', 'owner-b', 10_000).run(), /UNIQUE/);
});

test('two concurrent D1 lease contenders have exactly one winner', async () => {
    const provider = leaseProvider();
    const results = await Promise.allSettled([
        provider.acquire({ runId: 'run-a' }),
        provider.acquire({ runId: 'run-b' })
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    await results.find(result => result.status === 'fulfilled').value.release();
});

test('ten concurrent D1 lease contenders have exactly one winner', async () => {
    const provider = leaseProvider();
    const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) => provider.acquire({ runId: `run-${index}` }))
    );
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 9);
    await results.find(result => result.status === 'fulfilled').value.release();
});

test('expired lease is atomically taken over and the old owner cannot renew or release the new lease', async () => {
    let now = 10_000;
    const provider = leaseProvider(() => now);
    const oldLease = await provider.acquire({ runId: 'old-run' });
    now += 60_001;
    const newLease = await provider.acquire({ runId: 'new-run' });
    await assert.rejects(() => oldLease.renew(), error => error.code === 'OFFICIAL_CANARY_LEASE_LOST');
    assert.equal(await oldLease.release(), false);
    assert.equal(typeof await newLease.renew(), 'number');
    assert.equal(await newLease.release(), true);
});

test('same owner renews normally and release is owner-conditional', async () => {
    let now = 50_000;
    const provider = leaseProvider(() => now);
    const current = await provider.acquire({ runId: 'current-run' });
    now += 1_000;
    assert.equal(await current.renew(), now + 60_000);
    assert.equal(await current.release(), true);
    assert.equal(await current.release(), false);
});

test('one-time authorization is plan-bound, single-use, short-lived and cannot cross configId', async () => {
    let now = 100_000;
    let uuid = 0;
    const provider = createD1CanaryAuthorizationProvider({
        pool,
        clock: () => now,
        ttlMs: 30_000,
        randomUUID: () => `authorized-run-${++uuid}`,
        randomBytes: () => new Uint8Array(32).fill(uuid)
    });
    const base = specification();
    await assert.rejects(
        () => provider.issue(specification({ confirmationWord: undefined })),
        error => error.code === 'OFFICIAL_CANARY_CONFIRMATION_REQUIRED'
    );
    const first = await provider.issue(base);
    await provider.consume({ authorization: first, specification: base });
    await assert.rejects(
        () => provider.consume({ authorization: first, specification: base }),
        error => error.code === 'OFFICIAL_CANARY_AUTHORIZATION_INVALID'
    );

    const changed = await provider.issue(base);
    await assert.rejects(
        () => provider.consume({ authorization: changed, specification: specification({ testClassName: 'CHANGED' }) }),
        error => error.code === 'OFFICIAL_CANARY_AUTHORIZATION_PLAN_MISMATCH'
    );
    await assert.rejects(() => provider.consume({ authorization: changed, specification: base }));

    const crossConfig = await provider.issue(base);
    await assert.rejects(
        () => provider.consume({ authorization: crossConfig, specification: specification({ configId: 702 }) }),
        error => error.code === 'OFFICIAL_CANARY_AUTHORIZATION_PLAN_MISMATCH'
    );

    const expired = await provider.issue(base);
    now = expired.expiresAt + 1;
    await assert.rejects(
        () => provider.consume({ authorization: expired, specification: base }),
        error => error.code === 'OFFICIAL_CANARY_AUTHORIZATION_EXPIRED'
    );
});

test('runner stops before the next phase when its real D1 lease renewal fails', async () => {
    let now = 200_000;
    const lease = leaseProvider(() => now);
    const authorizationProvider = createD1CanaryAuthorizationProvider({
        pool,
        clock: () => now,
        ttlMs: 30_000,
        randomUUID: () => 'renewal-failure-run',
        randomBytes: () => new Uint8Array(32).fill(9)
    });
    const input = specification();
    const authorization = await authorizationProvider.issue(input);
    let executeCalls = 0;
    const runner = createOfficialCanaryRunner({
        executeStep: async () => { executeCalls += 1; return { success: true, code: 10000 }; },
        fetchImplementation: async () => new Response('ok'),
        resolveHostname: async () => ['127.0.0.1'],
        auditSink: createMemoryCanaryAuditSink(),
        leaseProvider: lease,
        authorizationProvider,
        loadCurrentSpecification: async () => input
    });
    await runner.start(input, authorization);
    await database.prepare("DELETE FROM d1_locks WHERE name = 'OFFICIAL_CANARY_SINGLE_TARGET'").run();
    await assert.rejects(
        () => runner.runPhase('connectivity'),
        error => error.code === 'OFFICIAL_CANARY_LEASE_LOST'
    );
    assert.equal(executeCalls, 0);
    assert.equal(runner.getState().status, 'failed');
});

test('sanitized audit written to D1 contains none of the fixed secrets', async () => {
    const secrets = ['SOAP_SECRET_FIXED', 'TOKEN_SECRET_FIXED', 'TICKET_SECRET_FIXED', 'AUTH_SECRET_FIXED'];
    const sink = {
        async append(record) {
            await database.prepare('INSERT INTO canary_audit_test (record_json) VALUES (?)')
                .bind(JSON.stringify(record)).run();
        }
    };
    const recorder = createCanaryAuditRecorder({ sink, secretValues: secrets, clock: () => 300_000 });
    await recorder.record('negative-secret-scan', {
        runId: 'audit-run', configId: 701, method: 'java', operation: 'tokenInfo', code: 10000,
        soapPassword: secrets[0], tokenPassword: secrets[1], platformToken: secrets[1],
        ticket: secrets[2], redirectUrl: `https://example.invalid/?u=${secrets[2]}`,
        authorization: secrets[3], clientinfo: secrets[0], body: `password=${secrets[0]}`, raw: secrets.join('|'),
        message: `safe-prefix ${secrets.join(' ')}`
    });
    const row = await database.prepare('SELECT record_json FROM canary_audit_test').first();
    for (const secret of secrets) assert.doesNotMatch(row.record_json, new RegExp(secret));
    assert.match(row.record_json, /negative-secret-scan/);
});
