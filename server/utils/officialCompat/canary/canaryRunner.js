import {
    CANARY_STEP_CONFIRMATION_WORD,
    validateCanarySpecification
} from './canaryGate.js';
import { createCanaryAuditRecorder } from './canaryAudit.js';
import { createOfficialCanaryPlan } from './canaryPlan.js';
import { OfficialCanarySequenceError } from './errors.js';
import { createCanaryFetch, createCanaryTargetPolicy } from './targetPolicy.js';
import { fingerprintCanaryPlan } from './planFingerprint.js';

export const CANARY_PHASES = Object.freeze([
    'connectivity',
    'student-first',
    'student-second',
    'teacher-first',
    'teacher-second',
    'java-token-recovery',
    'concurrency-two'
]);

const CREATE_OPERATIONS = new Set([
    'AddTrainGroup', 'AddAppraisalGroup', 'AddMegagameGroup', 'AddStudent', 'AddTeacher',
    'getUserName', 'getLoginTeacherName'
]);

function safeRunTarget(specification) {
    return Object.freeze({
        hostname: specification.allowedHostname,
        port: specification.allowedPort,
        path: specification.allowedContextPath
    });
}

function defaultLeaseProvider() {
    return Object.freeze({
        async acquire() {
            throw new OfficialCanarySequenceError('真实 canary 必须显式注入单目标 leaseProvider');
        }
    });
}

function assertPhaseResult(phase, operations, result) {
    if (!result || result.success !== true) {
        throw new OfficialCanarySequenceError(`canary 阶段失败: ${phase}`, {
            code: 'OFFICIAL_CANARY_STEP_FAILED',
            details: { phase, code: result?.code ?? null, message: result?.message ?? 'unknown' }
        });
    }
    if (phase === 'student-second') {
        const forbidden = operations.find(item => item.operationName === 'AddStudent' || /Add(?:Train|Appraisal|Megagame)Group/.test(item.operationName));
        if (forbidden) throw new OfficialCanarySequenceError('学生第二次进入发生重复创建', {
            code: 'OFFICIAL_CANARY_DUPLICATE_CREATE', details: { phase, operation: forbidden.operationName }
        });
    }
    if (phase === 'teacher-second') {
        const forbidden = operations.find(item => item.operationName === 'AddStudent'
            || item.operationName === 'AddTeacher'
            || /Add(?:Train|Appraisal|Megagame)Group/.test(item.operationName));
        if (forbidden) throw new OfficialCanarySequenceError('教师第二次进入发生重复创建', {
            code: 'OFFICIAL_CANARY_DUPLICATE_CREATE', details: { phase, operation: forbidden.operationName }
        });
    }
}

export function createOfficialCanaryRunner(options = {}) {
    if (typeof options.executeStep !== 'function') throw new TypeError('canary executeStep 必须显式注入');
    if (typeof options.fetchImplementation !== 'function') throw new TypeError('canary fetchImplementation 必须显式注入');
    if (typeof options.resolveHostname !== 'function') throw new TypeError('canary resolveHostname 必须显式注入');
    if (!options.authorizationProvider || typeof options.authorizationProvider.consume !== 'function') {
        throw new TypeError('canary authorizationProvider 必须显式注入');
    }
    if (typeof options.loadCurrentSpecification !== 'function') {
        throw new TypeError('canary loadCurrentSpecification 必须显式注入');
    }
    const audit = createCanaryAuditRecorder({
        sink: options.auditSink,
        clock: options.clock,
        secretValues: options.secretValues
    });
    const leaseProvider = options.leaseProvider || defaultLeaseProvider();
    let session = null;

    function publicState() {
        if (!session) return Object.freeze({ status: 'idle' });
        return Object.freeze({
            runId: session.runId,
            status: session.status,
            nextPhase: CANARY_PHASES[session.phaseIndex] || null,
            awaitingHumanConfirmation: session.awaitingHumanConfirmation,
            completedPhases: Object.freeze(session.completedPhases.slice())
        });
    }

    async function releaseLease() {
        if (session?.release) {
            const release = session.release;
            session.release = null;
            await release();
        }
    }

    async function markGuardFailure(error, stage) {
        if (session) {
            session.status = 'failed';
            session.stopped = true;
            await audit.record('run-failed', {
                runId: session.runId,
                phase: CANARY_PHASES[session.phaseIndex] || null,
                operation: null,
                code: error?.code || 'OFFICIAL_CANARY_GUARD_FAILED',
                message: error?.message || 'unknown',
                guardStage: stage,
                possibleSideEffects: []
            });
            await releaseLease();
        }
        throw error;
    }

    async function loadAndAssertFingerprint() {
        const current = await options.loadCurrentSpecification({
            configId: session.specification.configId,
            runId: session.runId
        });
        const normalized = validateCanarySpecification(current, { requireConfirmation: false });
        const fingerprint = await fingerprintCanaryPlan(normalized);
        if (fingerprint !== session.fingerprint) {
            throw new OfficialCanarySequenceError('canary plan 已变化，旧授权立即失效', {
                code: 'OFFICIAL_CANARY_PLAN_CHANGED'
            });
        }
        return normalized;
    }

    async function assertPhaseGuards({ checkTarget = true } = {}) {
        try {
            await session.renew();
            await loadAndAssertFingerprint();
            if (checkTarget) await session.policy.assertBaseTarget();
        } catch (error) {
            return markGuardFailure(error, checkTarget ? 'lease-plan-dns' : 'lease-plan');
        }
    }

    async function start(input, authorization) {
        if (session && !['completed', 'failed', 'aborted'].includes(session.status)) {
            throw new OfficialCanarySequenceError('同一 runner 已存在进行中的 canary');
        }
        if (!authorization || typeof authorization.runId !== 'string') {
            throw new OfficialCanarySequenceError('仅输入 RUN_OFFICIAL_CANARY 不足以执行；缺少一次性 authorization', {
                code: 'OFFICIAL_CANARY_AUTHORIZATION_REQUIRED'
            });
        }
        const specification = validateCanarySpecification(input, { requireConfirmation: false });
        const policy = createCanaryTargetPolicy(specification, { resolveHostname: options.resolveHostname });
        const runId = authorization.runId;
        let acquiredLease;
        try {
            acquiredLease = await leaseProvider.acquire({
                key: 'OFFICIAL_CANARY_SINGLE_TARGET',
                runId,
                configId: specification.configId,
                target: safeRunTarget(specification)
            });
        } catch (error) {
            throw error;
        }
        const release = typeof acquiredLease === 'function' ? acquiredLease : acquiredLease?.release;
        const renew = typeof acquiredLease?.renew === 'function' ? acquiredLease.renew : async () => {};
        if (typeof release !== 'function') throw new TypeError('canary leaseProvider.acquire 必须返回 release 函数或 lease handle');
        let consumed;
        try {
            consumed = await options.authorizationProvider.consume({ authorization, specification });
        } catch (error) {
            await release();
            throw error;
        }
        const canaryFetch = createCanaryFetch({
            fetchImplementation: options.fetchImplementation,
            policy,
            onRequest: async request => audit.record('network-request', { runId, ...request })
        });
        const plan = await createOfficialCanaryPlan(specification);
        if (plan.fingerprint !== consumed.fingerprint || consumed.runId !== runId) {
            await release();
            throw new OfficialCanarySequenceError('authorization 与 canary plan 不一致', {
                code: 'OFFICIAL_CANARY_AUTHORIZATION_PLAN_MISMATCH'
            });
        }
        session = {
            runId,
            specification,
            plan,
            fingerprint: consumed.fingerprint,
            policy,
            canaryFetch,
            status: 'ready',
            phaseIndex: 0,
            awaitingHumanConfirmation: false,
            completedPhases: [],
            release,
            renew,
            stopped: false
        };
        await audit.record('run-started', {
            runId,
            configId: specification.configId,
            method: specification.method,
            target: safeRunTarget(specification),
            testAccount: session.plan.loginName
        });
        return Object.freeze({ runId, plan: session.plan, state: publicState() });
    }

    async function runPhase(phase) {
        if (!session || session.status === 'idle') throw new OfficialCanarySequenceError('canary 尚未 start');
        if (session.status !== 'ready') throw new OfficialCanarySequenceError('canary 当前不可执行阶段', {
            details: { status: session.status }
        });
        if (session.awaitingHumanConfirmation) throw new OfficialCanarySequenceError('上一步尚未完成人工确认');
        const expected = CANARY_PHASES[session.phaseIndex];
        if (phase !== expected) throw new OfficialCanarySequenceError(`必须按顺序执行 ${expected}`);
        await assertPhaseGuards({ checkTarget: true });

        const operations = [];
        const stages = [];
        const stateWrites = new Set();
        const observeOperation = async event => {
            const safe = {
                operationName: String(event.operationName || ''),
                code: event.code ?? null,
                success: event.success === true,
                created: event.created === true
            };
            operations.push(safe);
            await audit.record('operation', { runId: session.runId, phase, ...safe });
        };
        const onStage = async (stage, message) => {
            const key = `${phase}:${stage}:success`;
            if (stateWrites.has(key)) return;
            stateWrites.add(key);
            stages.push({ stage, success: true });
            await audit.record('stage', { runId: session.runId, phase, stage, success: true, message });
        };
        const context = {
            runId: session.runId,
            phase,
            specification: session.specification,
            fetchImplementation: session.canaryFetch,
            observeOperation,
            onStage,
            recordStateWrite: async (name, success) => {
                const key = `${phase}:${name}:${success === true}`;
                if (stateWrites.has(key)) return false;
                stateWrites.add(key);
                await audit.record('state-write', { runId: session.runId, phase, name, success: success === true });
                return true;
            }
        };

        session.status = 'running';
        await audit.record('phase-started', { runId: session.runId, phase });
        try {
            let result;
            if (phase === 'connectivity') {
                if (typeof options.readOnlyProbe !== 'function'
                    || options.readOnlyProbeEvidence?.sideEffectFreeOfficiallyConfirmed !== true) {
                    result = { success: true, skipped: true, code: null, message: '无已确认绝对只读接口，已跳过' };
                } else {
                    result = await options.readOnlyProbe(context);
                }
            } else if (phase === 'java-token-recovery' && session.specification.method !== 'java') {
                result = { success: true, skipped: true, code: null, message: '非 JAVA 平台不执行 Token 恢复' };
            } else if (phase === 'concurrency-two') {
                const [first, second] = await Promise.all([
                    options.executeStep({ ...context, concurrentIndex: 0 }),
                    options.executeStep({ ...context, concurrentIndex: 1 })
                ]);
                result = {
                    success: first?.success === true && second?.success === true,
                    code: first?.code ?? second?.code ?? null,
                    message: first?.message || second?.message || '',
                    concurrentResults: 2
                };
                const createCounts = new Map();
                for (const item of operations.filter(item => CREATE_OPERATIONS.has(item.operationName) && item.created)) {
                    createCounts.set(item.operationName, (createCounts.get(item.operationName) || 0) + 1);
                }
                const duplicate = [...createCounts].find(([, count]) => count > 1);
                if (duplicate) throw new OfficialCanarySequenceError('两个并发请求产生重复创建', {
                    code: 'OFFICIAL_CANARY_CONCURRENCY_NOT_IDEMPOTENT',
                    details: { phase, operation: duplicate[0], count: duplicate[1] }
                });
            } else {
                result = await options.executeStep(context);
            }
            assertPhaseResult(phase, operations, result);
            await session.renew();
            session.status = 'ready';
            session.awaitingHumanConfirmation = true;
            await audit.record('phase-completed', {
                runId: session.runId,
                phase,
                code: result.code ?? null,
                skipped: result.skipped === true,
                operationOrder: operations.map(item => item.operationName),
                createdOperations: operations.filter(item => item.created).map(item => item.operationName),
                stages
            });
            return Object.freeze({
                runId: session.runId,
                phase,
                success: true,
                skipped: result.skipped === true,
                code: result.code ?? null,
                operationOrder: Object.freeze(operations.map(item => item.operationName)),
                createdOperations: Object.freeze(operations.filter(item => item.created).map(item => item.operationName)),
                redirectUrlGenerated: result.redirectUrlGenerated === true,
                state: publicState()
            });
        } catch (error) {
            session.status = 'failed';
            session.stopped = true;
            await audit.record('run-failed', {
                runId: session.runId,
                phase,
                operation: operations.at(-1)?.operationName ?? null,
                code: error?.code || 'OFFICIAL_CANARY_STEP_FAILED',
                message: error?.message || 'unknown',
                possibleSideEffects: operations.filter(item => item.created).map(item => item.operationName)
            });
            await releaseLease();
            throw error;
        }
    }

    async function confirmPhase({ phase, confirmationWord, humanResult }) {
        if (!session || session.status !== 'ready' || !session.awaitingHumanConfirmation) {
            throw new OfficialCanarySequenceError('当前没有待人工确认的阶段');
        }
        const expected = CANARY_PHASES[session.phaseIndex];
        if (phase !== expected || confirmationWord !== CANARY_STEP_CONFIRMATION_WORD) {
            throw new OfficialCanarySequenceError('阶段或人工确认词不匹配');
        }
        await assertPhaseGuards({ checkTarget: false });
        await audit.record('human-confirmation', {
            runId: session.runId,
            phase,
            accepted: humanResult?.accepted === true,
            note: humanResult?.note || ''
        });
        if (humanResult?.accepted !== true) {
            session.status = 'aborted';
            session.stopped = true;
            await releaseLease();
            return publicState();
        }
        session.completedPhases.push(phase);
        session.phaseIndex += 1;
        session.awaitingHumanConfirmation = false;
        if (session.phaseIndex >= CANARY_PHASES.length) {
            session.status = 'completed';
            await audit.record('run-completed', { runId: session.runId, success: true });
            await releaseLease();
        }
        return publicState();
    }

    async function abort(reason = 'operator-abort') {
        if (!session || ['completed', 'failed', 'aborted'].includes(session.status)) return publicState();
        session.status = 'aborted';
        session.stopped = true;
        await audit.record('run-aborted', { runId: session.runId, reason });
        await releaseLease();
        return publicState();
    }

    async function heartbeat() {
        if (!session || session.status !== 'ready') {
            throw new OfficialCanarySequenceError('canary 当前不可续租');
        }
        await assertPhaseGuards({ checkTarget: false });
        await audit.record('lease-heartbeat', {
            runId: session.runId,
            phase: CANARY_PHASES[session.phaseIndex] || null
        });
        return publicState();
    }

    return Object.freeze({ start, runPhase, confirmPhase, heartbeat, abort, getState: publicState });
}
