import {
    mapMarchCenterToOfficialParameters,
    resolveOfficialInstance,
    resolveOfficialPlatform,
    selectOfficialBaseUrl,
    selectOfficialCommonMethod,
    validateConfirmedOfficialBaseUrl,
    validateOfficialPaasV2Address,
    validateOfficialDirectUrl,
    validateOfficialBaseUrlConfirmation
} from './officialJumpConfig.js';
import { OfficialJumpConfigError } from './errors.js';

const JAVA_LONG_MIN = -(2n ** 63n);
const JAVA_LONG_MAX = (2n ** 63n) - 1n;
const SOAP_METHODS = new Set([
    'net', 'marketing', 'commerce', 'managementAccounting',
    'crossBorderCommerce', 'enterpriseManagement'
]);

function required(value, name) {
    if (value === undefined || value === null || value === '') {
        throw new OfficialJumpConfigError(`official-compat 缺少参数 ${name}`, {
            code: 'OFFICIAL_JUMP_PARAMETER_REQUIRED',
            details: { parameter: name }
        });
    }
}

function assertSafeLong(value, name) {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
            throw new OfficialJumpConfigError(`${name} 必须使用安全整数或十进制字符串`, {
                code: 'OFFICIAL_JUMP_LONG_UNSAFE', details: { parameter: name }
            });
        }
        return;
    }
    if (typeof value === 'bigint') {
        throw new OfficialJumpConfigError(`${name} 必须在进入兼容层前转换为十进制字符串`, {
            code: 'OFFICIAL_JUMP_LONG_UNSAFE', details: { parameter: name }
        });
    }
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return;
    const parsed = BigInt(value);
    if (parsed < JAVA_LONG_MIN || parsed > JAVA_LONG_MAX) {
        throw new OfficialJumpConfigError(`${name} 超出 Java long 范围`, {
            code: 'OFFICIAL_JUMP_LONG_OUT_OF_RANGE', details: { parameter: name }
        });
    }
}

function safeTarget(baseUrl) {
    const url = new URL(baseUrl);
    return Object.freeze({ protocol: url.protocol, host: url.host, path: url.pathname });
}

function urlRule(method, commonMethod) {
    if (method === 'direct') return 'return officialBaseUrl unchanged';
    if (method === 'paasV2') return 'POST trainJumpPath with data + platformToken';
    if (method === 'java') {
        return commonMethod === 'commonReturnTeacherBaseInfo'
            ? 'officialBaseUrl + /open/teacherIndex?needTheoryScore=1& + result.data'
            : 'officialBaseUrl + /open/enterIndex + result.data';
    }
    return commonMethod === 'commonReturnTeacherBaseInfo'
        ? 'officialBaseUrl + /Login.aspx?type=itmc&data= + result.data + &needTheoryScore=1'
        : 'officialBaseUrl + /Login.aspx?type=itmc&data= + result.data';
}

/** Synchronous, network-free structural validation. Returned data contains no credentials. */
export function validateOfficialJumpConfiguration(config = {}, context = {}) {
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    const instance = resolveOfficialInstance(config);
    validateOfficialBaseUrlConfirmation(config);
    const suppliedBaseUrl = selectOfficialBaseUrl(config, context);
    if (method === 'paasV2') {
        const baseUrl = validateOfficialPaasV2Address(suppliedBaseUrl, 'paasV2 apiBaseUrl/trainPath');
        const jumpBaseUrl = validateOfficialPaasV2Address(config.jumpBaseUrl || config.trainJumpPath, 'paasV2 jumpBaseUrl/trainJumpPath');
        const tempKey = config.tempKey && typeof config.tempKey === 'string'
            ? safeParseTempKey(config.tempKey)
            : (config.tempKey || null);
        if (!config.externalPublicKey && !tempKey?.publicKey) {
            throw new OfficialJumpConfigError('paasV2 缺少 externalPublicKey 或 tempKey.publicKey', {
                code: 'OFFICIAL_JUMP_PARAMETER_REQUIRED', details: { parameter: 'externalPublicKey' }
            });
        }
        if (!config.publicKey && !tempKey?.applicationPublicKey) {
            throw new OfficialJumpConfigError('paasV2 缺少 publicKey 或 tempKey.applicationPublicKey', {
                code: 'OFFICIAL_JUMP_PARAMETER_REQUIRED', details: { parameter: 'publicKey' }
            });
        }
        if (!config.productId) {
            throw new OfficialJumpConfigError('paasV2 缺少 productId', {
                code: 'OFFICIAL_JUMP_PARAMETER_REQUIRED', details: { parameter: 'productId' }
            });
        }
        return Object.freeze({
            adapter: 'official-compat',
            method,
            serviceName,
            instanceVariant: instance.id,
            instanceLabel: instance.label,
            commonMethod: null,
            target: safeTarget(baseUrl),
            jumpTarget: safeTarget(jumpBaseUrl),
            urlRule: urlRule(method, null),
            preserves: Object.freeze({ zero: false, false: false, null: false, emptyString: false })
        });
    }
    const baseUrl = method === 'direct'
        ? validateOfficialDirectUrl(suppliedBaseUrl)
        : validateConfirmedOfficialBaseUrl(suppliedBaseUrl);
    const commonMethod = method === 'direct' ? null : selectOfficialCommonMethod(config, context);
    const parameters = mapMarchCenterToOfficialParameters(config, context, baseUrl);

    if (method !== 'direct') {
        required(parameters.loginName, 'loginName');
        required(parameters.className, 'className');
        required(parameters.teacherUserName, 'teacherUserName');
        required(parameters.userId, 'userId');
        required(parameters.userName, 'userName');
        if (commonMethod === 'commonReturnTeacherBaseInfo' && parameters.studentList !== undefined
            && parameters.studentList !== null && !Array.isArray(parameters.studentList)) {
            throw new OfficialJumpConfigError('studentList 必须是数组、null 或 undefined', {
                code: 'OFFICIAL_JUMP_PARAMETER_INVALID', details: { parameter: 'studentList' }
            });
        }
    }
    assertSafeLong(parameters.userId, 'userId');
    assertSafeLong(parameters.startTime, 'startTime');
    assertSafeLong(parameters.endTime, 'endTime');

    return Object.freeze({
        adapter: 'official-compat',
        method,
        serviceName,
        instanceVariant: instance.id,
        instanceLabel: instance.label,
        commonMethod,
        target: safeTarget(baseUrl),
        urlRule: urlRule(method, commonMethod),
        preserves: Object.freeze({
            zero: Object.values(parameters).some(value => value === 0),
            false: Object.values(parameters).some(value => value === false),
            null: Object.values(parameters).some(value => value === null),
            emptyString: Object.values(parameters).some(value => value === '')
        })
    });
}

/** Pure-read preflight: validates URL/security and credentials, but performs no vendor request or mutation. */
export async function preflightOfficialPlatform(config = {}, context = {}, dependencies = {}) {
    const report = validateOfficialJumpConfiguration(config, context);
    if (typeof dependencies.urlValidator !== 'function') {
        throw new TypeError('urlValidator 必须是函数');
    }
    await dependencies.urlValidator(config, context);
    const usesReadyAccountFastPath = SOAP_METHODS.has(report.method)
        && context.accountWasReady === true
        && context.forceProvision !== true;
    if (report.method !== 'direct' && report.method !== 'paasV2' && !usesReadyAccountFastPath) {
        if (!dependencies.credentialsProvider || typeof dependencies.credentialsProvider.getCredentials !== 'function') {
            throw new TypeError('credentialsProvider.getCredentials 必须是函数');
        }
        await dependencies.credentialsProvider.getCredentials({ method: report.method, config });
    }
    return report;
}


function safeParseTempKey(value) {
    try { return JSON.parse(value); }
    catch { return null; }
}
