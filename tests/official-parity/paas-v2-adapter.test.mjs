import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
    buildPaasV2JumpData,
    createPaasV2Adapter,
    encryptRsaChunks
} from '../../server/utils/officialCompat/paasV2/paasV2Adapter.js';
import {
    createOfficialTokenStore,
    PAAS_V2_TOKEN_TTL_MS
} from '../../server/utils/officialCompat/tokenStore.js';

function createTestKeyPair() {
    return crypto.generateKeyPairSync('rsa', {
        modulusLength: 1024,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
}

function createTestConfig(publicKey) {
    return {
        apiBaseUrl: 'https://issuer.invalid/train/',
        jumpBaseUrl: 'https://issuer.invalid/train/enter',
        externalPublicKey: publicKey,
        publicKey
    };
}

function pemLines(key) {
    return key.replace(/\r/g, '').replace(/\n$/, '');
}

function decryptRsaChunks(ciphertext, privateKey) {
    const source = Buffer.from(ciphertext, 'base64');
    const chunks = [];
    for (let offset = 0; offset < source.length; offset += 128) {
        chunks.push(crypto.privateDecrypt({
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_PADDING
        }, source.subarray(offset, offset + 128)));
    }
    return Buffer.concat(chunks).toString('utf8');
}

test('paasV2 adapter uses answer type 1 for the login identity and POST form', async () => {
    const { publicKey, privateKey } = createTestKeyPair();

    let received;
    const fetchImplementation = async (url, init) => {
        received = { url, init };
        const body = JSON.parse(init.body);
        const inner = JSON.parse(body.data);
        const tokenInfo = JSON.parse(decryptRsaChunks(inner.ticket, privateKey));
        assert.equal(tokenInfo.userType, '2');
        assert.equal(tokenInfo.userName, 'mcsalice1_1_fixture-module');
        assert.equal(tokenInfo.teacherName, 'mcteacher_1_fixture-module');
        assert.equal(tokenInfo.className, 'mcclass_1_fixture-module');
        return new Response(JSON.stringify({ code: '10000', data: 'platform-token-123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const config = {
        ...createTestConfig(publicKey),
        productId: 'PT04',
        productModuleId: 'fixture-module',
        answerType: '4'
    };
    const adapter = createPaasV2Adapter({ config, fetchImplementation });
    const form = await adapter.buildJumpForm({
        loginName: 'mcsalice1',
        teacherUserName: 'mcteacher',
        className: 'mcclass',
        userName: 'Alice',
        currentLoginName: 'alice',
        loginRole: 'student',
        userId: 1,
        plugFlag: '1943850439576195074',
        answerType: '1,2,3,4',
        softwareUnique: 'fixture-module'
    });

    assert.equal(form.action, config.jumpBaseUrl);
    assert.equal(form.method, 'POST');
    assert.equal(form.fields.platformToken, 'platform-token-123');
    const jumpData = JSON.parse(decryptRsaChunks(form.fields.data, privateKey));
    assert.equal(jumpData.taskId, '1943850439576195074');
    assert.equal(jumpData.productModuleID, 'fixture-module');
    assert.equal(jumpData.answerType, 1);
    assert.equal(received.url, 'https://issuer.invalid/train/GetTokenInfo');
});

test('paasV2 encryptRsaChunks wraps raw base64 public keys into PEM', () => {
    const { publicKey } = createTestKeyPair();
    const raw = pemLines(publicKey).replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').replace(/\s/g, '');
    assert.ok(encryptRsaChunks('hello', raw).length > 0);
});

test('paasV2 reuses a student token until expiration, scoped to the account, task context and destination', async () => {
    const { publicKey } = createTestKeyPair();
    const config = createTestConfig(publicKey);
    let now = 1000;
    let requests = 0;
    const tokenStore = createOfficialTokenStore({ now: () => now, ttlMs: PAAS_V2_TOKEN_TTL_MS });
    const fetchImplementation = async () => Response.json({ code: '10000', data: `mock-${++requests}` });
    const parameters = { loginRole: 'student', loginName: 'test-student', className: 'test-class' };
    const launch = async (context, overrides = {}, mapped = parameters) => {
        const adapter = createPaasV2Adapter({ config: { ...config, ...overrides }, fetchImplementation, tokenStore });
        return (await adapter.buildJumpForm(mapped, context)).fields.platformToken;
    };
    const student = { user: { id: 1 } };

    assert.equal(await launch(student), 'mock-1');
    now += PAAS_V2_TOKEN_TTL_MS - 1;
    assert.equal(await launch(student), 'mock-1');
    assert.equal(await launch({ user: { id: 2 } }), 'mock-2');
    assert.equal(await launch(student, {}, { ...parameters, className: 'another-class' }), 'mock-3');
    assert.equal(await launch(student, { jumpBaseUrl: 'https://issuer.invalid/other/enter' }), 'mock-4');
    assert.equal(await launch(student, { publicKey: createTestKeyPair().publicKey }), 'mock-5');
    now++;
    assert.equal(await launch(student), 'mock-6');
});

test('paasV2 uses one task token flow for local roles and only caches for signed-in accounts', async () => {
    const { publicKey, privateKey } = createTestKeyPair();
    let requests = 0;
    const adapter = createPaasV2Adapter({
        config: createTestConfig(publicKey),
        tokenStore: createOfficialTokenStore(),
        fetchImplementation: async (_url, { body }) => {
            const { ticket } = JSON.parse(JSON.parse(body).data);
            assert.equal(JSON.parse(decryptRsaChunks(ticket, privateKey)).userType, '2');
            return Response.json({ code: '10000', data: `mock-${++requests}` });
        }
    });
    const parameters = { loginName: 'fixture-task-user' };
    const teacher = { user: { id: 1, role: 'teacher' } };
    const student = { user: { id: 2, role: 'student' } };
    assert.equal((await adapter.buildJumpForm(parameters, teacher)).fields.platformToken, 'mock-1');
    assert.equal((await adapter.buildJumpForm(parameters, teacher)).fields.platformToken, 'mock-1');
    assert.equal((await adapter.buildJumpForm(parameters, student)).fields.platformToken, 'mock-2');
    assert.equal((await adapter.buildJumpForm(parameters, student)).fields.platformToken, 'mock-2');
    assert.equal((await adapter.buildJumpForm(parameters)).fields.platformToken, 'mock-3');
    assert.equal((await adapter.buildJumpForm(parameters)).fields.platformToken, 'mock-4');
});

test('paasV2 uses only a complete temporary key pair', async () => {
    const regular = createTestKeyPair();
    const temporary = createTestKeyPair();
    const temporaryApplicationKey = createTestKeyPair().publicKey;
    const cases = [
        [{ publicKey: temporary.publicKey }, regular, regular.publicKey],
        [{ applicationPublicKey: temporaryApplicationKey }, regular, regular.publicKey],
        [{ publicKey: temporary.publicKey, applicationPublicKey: temporaryApplicationKey }, temporary, temporaryApplicationKey]
    ];

    for (const [tempKey, expectedIssuer, expectedApplicationKey] of cases) {
        const adapter = createPaasV2Adapter({
            config: { ...createTestConfig(regular.publicKey), tempKey: JSON.stringify(tempKey) },
            fetchImplementation: async (_url, { body }) => {
                const request = JSON.parse(JSON.parse(body).data);
                assert.equal(request.publicKey, expectedApplicationKey);
                assert.equal(JSON.parse(decryptRsaChunks(request.ticket, expectedIssuer.privateKey)).userType, '2');
                return Response.json({ code: '10000', data: 'mock-token' });
            }
        });
        const form = await adapter.buildJumpForm({ plugFlag: 'fixture-task' });
        assert.equal(JSON.parse(decryptRsaChunks(form.fields.data, expectedIssuer.privateKey)).taskId, 'fixture-task');
    }
});

test('paasV2 does not cache an unsuccessful HTTP response or expose its body', async () => {
    const { publicKey } = createTestKeyPair();
    let requests = 0;
    const adapter = createPaasV2Adapter({
        config: createTestConfig(publicKey),
        tokenStore: createOfficialTokenStore(),
        fetchImplementation: async () => ++requests === 1
            ? Response.json({ code: '10000', data: 'must-not-escape' }, { status: 503 })
            : Response.json({ code: '10000', data: 'good-token' })
    });
    const context = { user: { id: 1 } };
    await assert.rejects(() => adapter.buildJumpForm({}, context), error => {
        assert.equal(error.code, 'PAAS_V2_TOKEN_HTTP_FAILURE');
        assert.equal(error.details.httpStatus, 503);
        assert.equal(error.raw, null);
        return true;
    });
    assert.equal((await adapter.buildJumpForm({}, context)).fields.platformToken, 'good-token');
    assert.equal((await adapter.buildJumpForm({}, context)).fields.platformToken, 'good-token');
    assert.equal(requests, 2);
});

test('paasV2 launch payload normalizes legacy answer types to numeric 1', () => {
    assert.equal(buildPaasV2JumpData({ answerType: '4' }).answerType, 1);
    assert.equal(buildPaasV2JumpData({}, { answerType: '1,2,3,4' }).answerType, 1);
});

test('paasV2 refreshes an expired score token and handles an unstarted task', async () => {
    const { publicKey } = createTestKeyPair();
    const responses = [
        ['GetTokenInfo', null, { code: '10000', data: 'stale-mock' }],
        ['GetTaskState', 'stale-mock', { code: '10011' }],
        ['GetTokenInfo', null, { code: '10000', data: 'fresh-mock' }],
        ['GetTaskState', 'fresh-mock', { code: '10000', data: { finish: 1 } }],
        ['GetTrainingScore', 'fresh-mock', { code: '10000', data: { objScore: 64 } }],
        ['GetTaskState', 'fresh-mock', { code: '10001', message: '任务不存在' }]
    ];
    const adapter = createPaasV2Adapter({
        config: createTestConfig(publicKey),
        tokenStore: createOfficialTokenStore(),
        fetchImplementation: async (url, { headers }) => {
            const [operation, token, body] = responses.shift();
            assert.equal(new URL(url).pathname.split('/').at(-1), operation);
            assert.equal(new Headers(headers).get('platformToken'), token);
            return Response.json(body);
        }
    });
    const parameters = { plugFlag: 'fixture-task' };
    const context = { user: { id: 1 } };
    assert.deepEqual(await adapter.getTaskResult(parameters, context), { status: 'completed', score: 64 });
    assert.deepEqual(await adapter.getTaskResult(parameters, context), { status: 'in_progress', score: null });
    assert.equal(responses.length, 0);
});

test('paasV2 queries a finished task with the same authenticated token and derives its score', async () => {
    const { publicKey, privateKey } = createTestKeyPair();
    const order = [];
    const adapter = createPaasV2Adapter({
        config: createTestConfig(publicKey),
        tokenStore: createOfficialTokenStore(),
        fetchImplementation: async (url, request) => {
            const operation = new URL(url).pathname.split('/').at(-1);
            order.push(operation);
            if (operation === 'GetTokenInfo') return Response.json({ code: '10000', data: 'mock-token' });

            const { data } = JSON.parse(request.body);
            assert.equal(request.headers.platformToken, 'mock-token');
            assert.deepEqual(JSON.parse(data), { taskId: '1000000000000000004', answerType: 1 });
            const proof = JSON.parse(decryptRsaChunks(request.headers.sign, privateKey));
            assert.equal(proof.data, data);
            assert.ok(Number.isSafeInteger(proof.timestamp));
            return operation === 'GetTaskState'
                ? Response.json({ code: 10000, data: '{"finish":"1"}' })
                : Response.json({ code: 10000, data: { objScore: '73.52', subScore: 12.95 } });
        }
    });
    const parameters = { plugFlag: '1000000000000000004', answerType: '4', loginName: 'test-student' };
    const context = { user: { id: 1 } };
    await adapter.buildJumpForm(parameters, context);
    assert.deepEqual(await adapter.getTaskResult(parameters, context), { status: 'completed', score: 86.47 });
    assert.deepEqual(order, ['GetTokenInfo', 'GetTaskState', 'GetTrainingScore']);
});

test('paasV2 resets a task with string answer type 1', async () => {
    const { publicKey } = createTestKeyPair();
    const operations = [];
    const adapter = createPaasV2Adapter({
        config: { ...createTestConfig(publicKey), answerType: '2' },
        fetchImplementation: async (url, request) => {
            const operation = new URL(url).pathname.split('/').at(-1);
            operations.push(operation);
            if (operation === 'GetTokenInfo') return Response.json({ code: '10000', data: 'mock-token' });

            const { data } = JSON.parse(request.body);
            assert.deepEqual(JSON.parse(data), { taskId: 'fixture-task', answerType: '1' });
            return Response.json({ code: '10000' });
        }
    });

    assert.equal(await adapter.resetTaskData({ plugFlag: 'fixture-task', answerType: '1,2,3,4' }), true);
    assert.deepEqual(operations, ['GetTokenInfo', 'ResetTaskData']);
});

test('paasV2 preserves zero and keeps ungraded results distinct from a score', async () => {
    const { publicKey } = createTestKeyPair();
    const cases = [
        [2, null, { status: 'in_progress', score: null }],
        [3, null, { status: 'scoring', score: null }],
        [1, null, { status: 'scoring', score: null }],
        [1, '{"objScore":null,"subScore":""}', { status: 'scoring', score: null }],
        [1, '{"objScore":0}', { status: 'completed', score: 0 }],
        [1, '{"score":"52.3"}', { status: 'completed', score: 52.3 }]
    ];

    for (const [finish, scoreData, expected] of cases) {
        let gradeRequests = 0;
        const adapter = createPaasV2Adapter({
            config: createTestConfig(publicKey),
            fetchImplementation: async (url) => {
                if (url.endsWith('/GetTokenInfo')) return Response.json({ code: 10000, data: 'mock-token' });
                if (url.endsWith('/GetTaskState')) return Response.json({ code: 10000, data: { finish } });
                gradeRequests++;
                assert.ok(url.endsWith('/GetTrainingScore'));
                return Response.json({ code: 10000, data: scoreData });
            }
        });
        const result = await adapter.getTaskResult({ plugFlag: 'fixture-task' }, { user: { id: 2 } });
        assert.deepEqual(result, expected);
        assert.equal(gradeRequests, finish === 1 ? 1 : 0);
    }
});

test('paasV2 task score lookup requires an authenticated account and sanitizes issuer failures', async () => {
    const { publicKey } = createTestKeyPair();
    let requests = 0;
    const adapter = createPaasV2Adapter({
        config: createTestConfig(publicKey),
        fetchImplementation: async (url) => {
            requests++;
            if (url.endsWith('/GetTokenInfo')) return Response.json({ code: 10000, data: 'mock-token' });
            return Response.json({ code: 10010, message: 'synthetic-issuer-data' });
        }
    });
    const parameters = { plugFlag: 'fixture-task' };
    await assert.rejects(() => adapter.getTaskResult(parameters), { code: 'OFFICIAL_ADAPTER_PARAMETER_ERROR' });
    assert.equal(requests, 0);
    await assert.rejects(() => adapter.getTaskResult(parameters, { user: { id: 2 } }), error => {
        assert.equal(error.code, 'PAAS_V2_TASK_RESULT_FAILURE');
        assert.equal(error.stage, 'GetTaskState');
        assert.equal(error.raw, null);
        assert.ok(!JSON.stringify(error).includes('synthetic-issuer-data'));
        return true;
    });
});
