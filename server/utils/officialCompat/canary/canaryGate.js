import { validateConfirmedOfficialBaseUrl } from '../officialJumpConfig.js';
import { OfficialCanaryGateError } from './errors.js';

export const CANARY_CONFIRMATION_WORD = 'RUN_OFFICIAL_CANARY';
export const CANARY_STEP_CONFIRMATION_WORD = 'CONFIRM_CANARY_STEP';
export const CANARY_METHODS = Object.freeze(['java', 'net', 'marketing', 'commerce']);

const JAVA_LONG_MIN = -(2n ** 63n);
const JAVA_LONG_MAX = (2n ** 63n) - 1n;

function requiredText(value, field) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialCanaryGateError(`canary 缺少 ${field}`, { details: { field } });
    }
    return value;
}

function assertDecimalLong(value, field) {
    const text = requiredText(value, field);
    if (!/^-?\d+$/.test(text)) {
        throw new OfficialCanaryGateError(`${field} 必须是十进制 Java long 字符串`, { details: { field } });
    }
    const parsed = BigInt(text);
    if (parsed < JAVA_LONG_MIN || parsed > JAVA_LONG_MAX) {
        throw new OfficialCanaryGateError(`${field} 超出 Java long 范围`, { details: { field } });
    }
}

function effectivePort(url) {
    return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

function normalizedHostname(value) {
    return String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function validateCanarySpecification(input = {}, options = {}) {
    const requireConfirmation = options.requireConfirmation !== false;
    if (!Number.isInteger(Number(input.configId)) || Number(input.configId) < 1) {
        throw new OfficialCanaryGateError('canary configId 必须是正整数', { details: { field: 'configId' } });
    }
    if (!CANARY_METHODS.includes(input.method)) {
        throw new OfficialCanaryGateError('canary 平台仅支持 java/net/marketing/commerce', {
            details: { field: 'method' }
        });
    }
    const officialBaseUrl = validateConfirmedOfficialBaseUrl(requiredText(input.officialBaseUrl, 'officialBaseUrl'));
    const url = new URL(officialBaseUrl);
    const allowedHostname = normalizedHostname(requiredText(input.allowedHostname, 'allowedHostname'));
    if (allowedHostname.includes('*') || allowedHostname === 'localhost') {
        throw new OfficialCanaryGateError('allowedHostname 必须是精确 hostname/IP，且不能使用 localhost', {
            details: { field: 'allowedHostname' }
        });
    }
    if (normalizedHostname(url.hostname) !== allowedHostname) {
        throw new OfficialCanaryGateError('officialBaseUrl hostname 与显式白名单不一致', {
            details: { field: 'allowedHostname' }
        });
    }
    if (!Number.isInteger(input.allowedPort) || input.allowedPort < 1 || input.allowedPort > 65535) {
        throw new OfficialCanaryGateError('allowedPort 必须是显式的 1-65535 整数', {
            details: { field: 'allowedPort' }
        });
    }
    if (effectivePort(url) !== input.allowedPort) {
        throw new OfficialCanaryGateError('officialBaseUrl port 与显式白名单不一致', {
            details: { field: 'allowedPort' }
        });
    }
    requiredText(input.cardUrl, 'cardUrl');
    requiredText(input.testStudentAccount, 'testStudentAccount');
    requiredText(input.testTeacherAccount, 'testTeacherAccount');
    requiredText(input.testClassName, 'testClassName');
    assertDecimalLong(input.testUserId, 'testUserId');
    if (![1, 2, 3].includes(input.classType)) {
        throw new OfficialCanaryGateError('classType 只允许 1、2、3', { details: { field: 'classType' } });
    }
    if (!['train', 'exam'].includes(input.trainOrExam)) {
        throw new OfficialCanaryGateError('trainOrExam 只允许 train 或 exam', {
            details: { field: 'trainOrExam' }
        });
    }
    for (const field of [
        'credentialsConfigured',
        'isolatedTestEnvironmentConfirmed',
        'snapshotOrCleanupReady'
    ]) {
        if (input[field] !== true) {
            throw new OfficialCanaryGateError(`${field} 必须明确为 true`, { details: { field } });
        }
    }
    if (!Array.isArray(input.approvedResolvedAddresses) || input.approvedResolvedAddresses.length === 0
        || input.approvedResolvedAddresses.some(value => typeof value !== 'string' || value.length === 0)) {
        throw new OfficialCanaryGateError('必须提供非空的 approvedResolvedAddresses 精确 IP 列表', {
            details: { field: 'approvedResolvedAddresses' }
        });
    }
    if (requireConfirmation && input.confirmationWord !== CANARY_CONFIRMATION_WORD) {
        throw new OfficialCanaryGateError(`执行前必须输入一次性确认词 ${CANARY_CONFIRMATION_WORD}`, {
            code: 'OFFICIAL_CANARY_CONFIRMATION_REQUIRED', details: { field: 'confirmationWord' }
        });
    }
    return Object.freeze({
        ...input,
        configId: Number(input.configId),
        officialBaseUrl,
        allowedHostname,
        allowedContextPath: url.pathname,
        approvedResolvedAddresses: Object.freeze([...new Set(input.approvedResolvedAddresses.map(normalizedHostname))]),
        testStudentList: Object.freeze(Array.isArray(input.testStudentList)
            ? input.testStudentList.slice()
            : [input.testStudentAccount])
    });
}
