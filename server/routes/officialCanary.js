import express from '../compat/express.js';
import pool from '../config/db.js';
import { decodeStoredConfig } from '../utils/configSecrets.js';
import { executePlatformJump } from '../utils/platformJumpDispatcher.js';
import {
    CANARY_CONFIRMATION_WORD,
    CANARY_STEP_CONFIRMATION_WORD,
    createD1CanaryAuthorizationProvider,
    createD1CanaryLeaseProvider,
    createOfficialCanaryRunner,
    fingerprintCanaryPlan,
    resolveCanaryHostname
} from '../utils/officialCompat/canary/index.js';

const router = express.Router();
const BOOTSTRAP_PREFIX = 'OFFICIAL_CANARY_BOOTSTRAP:';
const EXACT_TARGET = Object.freeze({
    method: 'java',
    officialBaseUrl: 'http://8.138.27.219:8872/DS50109',
    allowedHostname: '8.138.27.219',
    allowedPort: 8872,
    allowedContextPath: '/DS50109',
    approvedResolvedAddresses: Object.freeze(['8.138.27.219'])
});

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function loadDedicatedConfig(configId) {
    const [rows] = await pool.query('SELECT id, name, base_url, config_data FROM sso_configs WHERE id = ? LIMIT 1', [configId]);
    if (!Array.isArray(rows) || rows.length !== 1) throw Object.assign(new Error('专用 canary 配置不存在'), { status: 404 });
    const row = rows[0];
    const config = decodeStoredConfig(row.config_data || '{}');
    if (config.canaryOnly !== true || config.canaryStatus !== 'prepared') {
        throw Object.assign(new Error('配置不是待执行的专用 canary 配置'), { status: 409 });
    }
    if (config.method !== EXACT_TARGET.method) {
        throw Object.assign(new Error('专用 canary 配置平台不匹配'), { status: 409 });
    }
    if (config.officialBaseUrl !== EXACT_TARGET.officialBaseUrl || config.cardUrl !== EXACT_TARGET.officialBaseUrl) {
        throw Object.assign(new Error('专用 canary 配置目标已变化'), { status: 409 });
    }
    return { row, config };
}

function specificationFrom(configId, config, confirmationWord = undefined) {
    if (config.plaintextHttpRiskAccepted !== true
        || config.disposableTestCredentialsConfirmed !== true
        || config.credentialRotationAfterTestConfirmed !== true) {
        throw Object.assign(new Error('HTTP 或可废弃凭据风险确认不完整'), { status: 409 });
    }
    return {
        configId,
        method: EXACT_TARGET.method,
        officialBaseUrl: EXACT_TARGET.officialBaseUrl,
        allowedHostname: EXACT_TARGET.allowedHostname,
        allowedPort: EXACT_TARGET.allowedPort,
        allowedContextPath: EXACT_TARGET.allowedContextPath,
        approvedResolvedAddresses: [...EXACT_TARGET.approvedResolvedAddresses],
        privateTargetExplicitlyApproved: false,
        cardUrl: EXACT_TARGET.officialBaseUrl,
        testStudentAccount: config.canaryTestStudentAccount,
        testTeacherAccount: config.canaryTestTeacherAccount,
        testStudentList: [config.canaryTestStudentAccount],
        testClassName: config.canaryTestClassName,
        testUserId: config.canaryTestUserId,
        classType: 1,
        trainOrExam: 'train',
        credentialsConfigured: true,
        isolatedTestEnvironmentConfirmed: true,
        snapshotOrCleanupReady: true,
        confirmationWord
    };
}

async function consumeBootstrap(token, specification) {
    if (typeof token !== 'string' || token.length < 32) {
        throw Object.assign(new Error('缺少一次性 canary bootstrap'), { status: 403 });
    }
    const tokenHash = await sha256Hex(token);
    const [rows] = await pool.query(
        'DELETE FROM d1_locks WHERE name = ? RETURNING owner, expires_at',
        [`${BOOTSTRAP_PREFIX}${tokenHash}`]
    );
    if (!Array.isArray(rows) || rows.length !== 1 || Number(rows[0].expires_at) <= Date.now()) {
        throw Object.assign(new Error('canary bootstrap 无效、过期或已使用'), { status: 403 });
    }
    let owner;
    try { owner = JSON.parse(rows[0].owner); }
    catch { throw Object.assign(new Error('canary bootstrap 绑定损坏'), { status: 403 }); }
    const fingerprint = await fingerprintCanaryPlan(specification);
    if (owner.configId !== specification.configId || owner.fingerprint !== fingerprint) {
        throw Object.assign(new Error('canary bootstrap 与当前 plan 不匹配'), { status: 403 });
    }
    return fingerprint;
}

function operationFromUrl(value) {
    try { return new URL(value instanceof Request ? value.url : value).pathname.split('/').filter(Boolean).at(-1) || 'unknown'; }
    catch { return 'unknown'; }
}

async function responseCode(response) {
    try {
        const parsed = JSON.parse(await response.clone().text());
        return parsed && Object.prototype.hasOwnProperty.call(parsed, 'code') ? parsed.code : null;
    } catch { return null; }
}

function d1AuditSink(runRef) {
    let sequence = 0;
    return Object.freeze({
        async append(record) {
            sequence += 1;
            await pool.query(
                'INSERT INTO system_configs (config_key, config_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [`official_canary_audit:${runRef.value || 'pending'}:${String(sequence).padStart(3, '0')}`, JSON.stringify(record)]
            );
        }
    });
}

router.post('/execute-java-student-once', async (req, res) => {
    const configId = Number(req.body?.configId);
    const confirmationWord = req.body?.confirmationWord;
    let runner;
    let possibleSideEffects = [];
    try {
        if (!Number.isInteger(configId) || configId < 1 || confirmationWord !== CANARY_CONFIRMATION_WORD) {
            return res.status(400).json({ error: 'canary 请求参数无效' });
        }
        const loaded = await loadDedicatedConfig(configId);
        const specification = specificationFrom(configId, loaded.config, confirmationWord);
        const fingerprint = await consumeBootstrap(req.headers['x-canary-bootstrap'], specification);
        const runRef = { value: '' };
        const authorizationProvider = createD1CanaryAuthorizationProvider({ pool, ttlMs: 5 * 60 * 1000 });
        const authorization = await authorizationProvider.issue(specification);
        runRef.value = authorization.runId;
        const leaseProvider = createD1CanaryLeaseProvider({ pool });
        const operations = [];
        const stages = [];
        let redirectTarget = null;
        let officialCalls = 0;

        const loadCurrentSpecification = async () => {
            const current = await loadDedicatedConfig(configId);
            return specificationFrom(configId, current.config);
        };
        const executeStep = async context => {
            officialCalls += 1;
            const observedFetch = async (input, init) => {
                const operationName = operationFromUrl(input);
                const response = await context.fetchImplementation(input, init);
                const code = await responseCode(response);
                const event = {
                    operationName,
                    code,
                    success: Number(code) === 10000,
                    created: operationName === 'getUserName' && Number(code) === 10000
                };
                operations.push(event);
                if (event.created) possibleSideEffects.push('getUserName');
                await context.observeOperation(event);
                return response;
            };
            const redirectUrl = await executePlatformJump(loaded.config, {
                cardUrl: specification.cardUrl,
                loginRole: 'student',
                loginName: specification.testStudentAccount,
                className: specification.testClassName,
                teacherUserName: specification.testTeacherAccount,
                studentList: [specification.testStudentAccount],
                userId: specification.testUserId,
                userName: specification.testStudentAccount,
                classType: 1,
                trainOrExam: 'train',
                onStage: async (stage, message) => {
                    stages.push(stage);
                    await context.onStage(stage, message);
                }
            }, {
                official: {
                    fetchImplementation: observedFetch,
                    logger: Object.freeze({ info() {}, error() {} })
                }
            });
            const parsed = new URL(redirectUrl);
            redirectTarget = { host: parsed.host, path: parsed.pathname };
            await context.recordStateWrite('account-ready', true);
            return { success: true, code: 10000, redirectUrlGenerated: true };
        };

        runner = createOfficialCanaryRunner({
            executeStep,
            fetchImplementation: globalThis.fetch,
            resolveHostname: resolveCanaryHostname,
            auditSink: d1AuditSink(runRef),
            leaseProvider,
            authorizationProvider,
            loadCurrentSpecification
        });
        await runner.start(specification, authorization);
        await runner.runPhase('connectivity');
        await runner.confirmPhase({
            phase: 'connectivity',
            confirmationWord: CANARY_STEP_CONFIRMATION_WORD,
            humanResult: { accepted: true, note: '无已确认只读接口，零网络跳过' }
        });
        const phase = await runner.runPhase('student-first');
        await runner.abort('student-first-only-awaiting-manual-verification');
        await pool.query(
            "UPDATE sso_configs SET config_data = json_set(config_data, '$.canaryStatus', 'awaiting-manual-verification') WHERE id = ? AND json_extract(config_data, '$.canaryOnly') = 1",
            [configId]
        );
        return res.json({
            success: true,
            runId: authorization.runId,
            fingerprint,
            configId,
            method: EXACT_TARGET.method,
            serviceName: 'NewTrainingInterfaceUtilService',
            operationOrder: operations.map(item => item.operationName),
            operationCodes: operations.map(item => ({ operation: item.operationName, code: item.code })),
            redirectUrlGenerated: phase.redirectUrlGenerated === true,
            redirectTarget,
            stages,
            stateWrites: ['account-ready', 'config:awaiting-manual-verification'],
            triggered10011: operations.some(item => Number(item.code) === 10011),
            officialCalls,
            doubleExecution: false,
            leaseStatus: runner.getState().status,
            authorizationConsumed: true,
            possibleStudentCreation: possibleSideEffects.includes('getUserName')
        });
    } catch (error) {
        try { await runner?.abort('student-first-failed'); } catch {}
        return res.status(Number(error?.status) || 500).json({
            success: false,
            stage: error?.stage || 'canary',
            operation: null,
            code: error?.code || 'OFFICIAL_CANARY_FAILED',
            message: 'official canary 执行失败',
            possibleClassCreated: false,
            possibleStudentCreated: possibleSideEffects.length > 0
        });
    }
});

export default router;
