import { createTrainingEntrance } from './trainingEntrance.js';
import {
    buildDirectJumpUrl,
    buildJavaJumpUrl,
    buildJavaTeacherJumpUrl,
    buildSoapJumpUrl
} from './jumpUrlBuilder.js';
import {
    mapMarchCenterToOfficialParameters,
    resolveOfficialPlatform,
    resolveOfficialInstance,
    selectOfficialBaseUrl,
    selectOfficialCommonMethod,
    validateConfirmedOfficialBaseUrl,
    validateOfficialPaasV2Address
} from './officialJumpConfig.js';
import { OfficialJumpExecutionError } from './errors.js';
import { buildCiphertext } from './ticketCodec.js';
import { createPaasV2Adapter } from './paasV2/paasV2Adapter.js';

const SOAP_METHODS = new Set([
    'net', 'marketing', 'commerce', 'managementAccounting',
    'crossBorderCommerce', 'enterpriseManagement'
]);
const SAFE_OPERATION_NAME = /^[A-Za-z][A-Za-z0-9]{0,79}$/;
const MAX_RESULT_MESSAGE_LENGTH = 240;

function targetHost(value) {
    try { return new URL(value).hostname; }
    catch { return '[invalid-host]'; }
}

function safeOperationName(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return SAFE_OPERATION_NAME.test(text) ? text : null;
}

function safeResultCode(value) {
    const code = Number(value);
    return Number.isInteger(code) ? code : null;
}

function safeResultSuccess(value) {
    if (value === true || value === false) return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}

function safeResultMessage(value) {
    if (typeof value !== 'string') return null;
    const normalized = value
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (!normalized) return null;
    return normalized
        .replace(
            /((?:password|pwd|token|authorization|credential|密码|令牌|授权)\s*(?:["']?\s*[:=：]\s*["']?))[^,;，；\s<>"']+/gi,
            '$1[REDACTED]'
        )
        .slice(0, MAX_RESULT_MESSAGE_LENGTH);
}

function safeFailureDetails(error) {
    const details = error?.details && typeof error.details === 'object' ? error.details : {};
    const resultCode = safeResultCode(details.resultCode);
    const resultSucc = safeResultSuccess(details.resultSucc);
    const resultMessage = safeResultMessage(details.resultMessage);
    const operationName = safeOperationName(error?.operationName || details.operationName);
    const httpStatus = Number(error?.status);
    return {
        ...(operationName ? { operationName } : {}),
        ...(resultCode !== null ? { resultCode } : {}),
        ...(resultSucc !== null ? { resultSucc } : {}),
        ...(resultMessage ? { resultMessage } : {}),
        ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {})
    };
}

function safeMetadata({ method, serviceName, baseUrl, commonMethod, error }) {
    return {
        adapter: 'official-compat',
        method,
        serviceName,
        operationStage: error?.stage || 'jump-execution',
        targetHost: targetHost(baseUrl),
        commonMethod,
        code: error?.code || 'OFFICIAL_JUMP_EXECUTION_ERROR',
        ...safeFailureDetails(error)
    };
}

function assertSuccessfulResult(result, metadata) {
    if (!result || typeof result !== 'object' || Number(result.code) !== 10000 || result.succ !== true) {
        throw new OfficialJumpExecutionError('official-compat 返回非成功 Result', {
            code: 'OFFICIAL_JUMP_RESULT_FAILURE',
            details: {
                ...metadata,
                resultCode: result && typeof result === 'object' ? result.code : null,
                resultSucc: result && typeof result === 'object' ? result.succ : null,
                resultMessage: result && typeof result === 'object' ? result.message : null,
                operationName: result && typeof result === 'object' ? result.operationName : null
            }
        });
    }
    if (typeof result.data !== 'string' || result.data.length === 0) {
        throw new OfficialJumpExecutionError('official-compat 成功 Result 缺少登录 data', {
            code: 'OFFICIAL_JUMP_DATA_MISSING',
            details: metadata
        });
    }
    return result.data;
}

export async function executeOfficialJump(config, context = {}, dependencies) {
    if (!dependencies) throw new TypeError('official dependencies 必须显式注入');
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    const instance = resolveOfficialInstance(config);
    const suppliedBaseUrl = selectOfficialBaseUrl(config, context);
    const reportStage = async (stage, message) => {
        if (typeof context?.onStage === 'function') await context.onStage(stage, message);
    };
    if (method === 'direct') {
        await reportStage('check_connection', '正在校验 official-compat 平台配置…');
        const directUrl = buildDirectJumpUrl(suppliedBaseUrl);
        await reportStage('prepare_entry', '连接检查完成，正在准备入口…');
        return directUrl;
    }

    if (method === 'paasV2') {
        const mappedParameters = mapMarchCenterToOfficialParameters(config, context, suppliedBaseUrl);
        const adapter = createPaasV2Adapter({
            config,
            fetchImplementation: dependencies.fetchImplementation,
            timeoutMs: dependencies.timeoutMs,
            maxResponseBytes: dependencies.maxResponseBytes
        });
        await reportStage('check_connection', '正在获取大渔智能体平台 token…');
        const postForm = await adapter.buildJumpForm(mappedParameters, context);
        await reportStage('prepare_entry', '大渔智能体入口已就绪，正在准备免密跳转…');
        return { postForm };
    }

    const baseUrl = validateConfirmedOfficialBaseUrl(suppliedBaseUrl);
    const commonMethod = selectOfficialCommonMethod(config, context);
    const mappedParameters = mapMarchCenterToOfficialParameters(config, context, baseUrl);
    const parameters = method === 'java' && context.accountWasReady === true && context.forceProvision !== true
        ? Object.freeze({ ...mappedParameters, accountWasReady: true })
        : mappedParameters;
    const metadata = {
        adapter: 'official-compat', method, serviceName,
        instanceVariant: instance.id, instanceLabel: instance.label,
        commonMethod, targetHost: targetHost(baseUrl)
    };
    try {
        await reportStage('check_connection', '正在校验 official-compat 平台配置…');
        if (SOAP_METHODS.has(method) && context.accountWasReady === true && context.forceProvision !== true) {
            // SOAP platform tickets are generated locally. Once MarchCenter
            // has positively provisioned this exact role/account, entering it
            // again does not need three remote existence checks. Administrators
            // can clear that readiness marker from the card maintenance panel
            // to force the full verify-and-repair workflow next time.
            const ticket = buildCiphertext({
                studentID: parameters.loginName,
                password: '',
                nickName: ''
            }, 'itmc');
            await reportStage('prepare_entry', '账号已就绪，正在通过快速通道准备入口…');
            return buildSoapJumpUrl(baseUrl, ticket, 'itmc', {
                includeNeedTheoryScore: commonMethod === 'commonReturnTeacherBaseInfo'
            });
        }
        const credentials = await dependencies.credentialsProvider.getCredentials({ method, config });
        const entrance = dependencies.trainingEntrance || createTrainingEntrance();
        const result = await entrance.executeNew({
            serviceName,
            methodName: commonMethod,
            parameters,
            url: baseUrl,
            adapterOptions: {
                fetchImplementation: dependencies.fetchImplementation,
                tokenStore: dependencies.tokenStore,
                credentials,
                timeoutMs: dependencies.timeoutMs,
                maxResponseBytes: dependencies.maxResponseBytes
            }
        });
        const resultData = assertSuccessfulResult(result, metadata);
        await reportStage('check_class', '远端班级检查已成功完成');
        await reportStage('create_account', '远端账号检查与必要创建已成功完成');
        const redirectUrl = method === 'java'
            ? (commonMethod === 'commonReturnTeacherBaseInfo'
                ? buildJavaTeacherJumpUrl(baseUrl, resultData)
                : buildJavaJumpUrl(baseUrl, resultData))
            : buildSoapJumpUrl(baseUrl, resultData, 'itmc', {
                includeNeedTheoryScore: commonMethod === 'commonReturnTeacherBaseInfo'
            });
        await reportStage('prepare_entry', '账号与班级已就绪，正在准备入口…');
        return redirectUrl;
    } catch (cause) {
        const safe = safeMetadata({ method, serviceName, baseUrl, commonMethod, error: cause });
        dependencies.logger.error(safe);
        if (cause instanceof OfficialJumpExecutionError) throw cause;
        throw new OfficialJumpExecutionError('official-compat 执行失败', {
            cause,
            code: cause?.code || 'OFFICIAL_JUMP_EXECUTION_ERROR',
            stage: cause?.stage || 'jump-execution',
            details: safe
        });
    }
}

function plannedSteps(method, commonMethod, parameters) {
    if (method === 'direct') return ['validateUrl', 'returnDirectUrl'];
    if (method === 'paasV2') return ['validateUrl', 'getPlatformToken', 'buildEncryptedJumpData', 'buildPostForm'];
    if (method === 'java') {
        if (commonMethod === 'commonReturnTeacherBaseInfo') {
            return [
                'tokenInfo(cache-or-fetch)',
                'getLoginTeacherName',
                'getUserName(each student)',
                'buildJavaTeacherJumpUrl'
            ];
        }
        return [
            'tokenInfo(cache-or-fetch)',
            'getUserName',
            parameters.trainOrExam === 'exam' ? 'trainingExamPaperV2' : 'trainingExamPaper',
            'buildJavaJumpUrl'
        ];
    }
    const groupStep = method === 'crossBorderCommerce'
        ? 'AddGroup|AddMegagameGroup(if missing)'
        : 'AddTrainGroup|AddAppraisalGroup|AddMegagameGroup(if missing)';
    if (commonMethod === 'commonReturnTeacherBaseInfo') {
        return ['IsGroupExisted', groupStep, 'IsTeacherExisted', 'AddTeacher(if missing)', 'IsStuExisted', 'AddStudent(if missing)', 'buildTicket', 'buildSoapJumpUrl'];
    }
    return ['IsGroupExisted', groupStep, 'IsStuExisted', 'AddStudent(if missing)', 'buildTicket', 'buildSoapJumpUrl'];
}

/** Pure planning only: no credentials, ticket generation, adapter invocation or network. */
export function planOfficialJump(config, context = {}) {
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    const instance = resolveOfficialInstance(config);
    const suppliedBaseUrl = selectOfficialBaseUrl(config, context);
    const baseUrl = method === 'direct' ? suppliedBaseUrl
        : method === 'paasV2' ? validateOfficialPaasV2Address(suppliedBaseUrl, 'paasV2 apiBaseUrl/trainPath')
        : validateConfirmedOfficialBaseUrl(suppliedBaseUrl);
    const commonMethod = method === 'direct' || method === 'paasV2' ? null : selectOfficialCommonMethod(config, context);
    const parameters = mapMarchCenterToOfficialParameters(config, context, baseUrl);
    const urlRule = method === 'direct'
        ? 'return input URL unchanged'
        : method === 'paasV2'
            ? 'POST trainJumpPath with data + platformToken'
            : method === 'java'
            ? (commonMethod === 'commonReturnTeacherBaseInfo'
                ? 'baseUrl + /open/teacherIndex?needTheoryScore=1& + result.data'
                : 'baseUrl + /open/enterIndex + ?|& + result.data')
            : (commonMethod === 'commonReturnTeacherBaseInfo'
                ? 'baseUrl + /Login.aspx?type=itmc&data= + result.data + &needTheoryScore=1'
                : 'baseUrl + /Login.aspx?type=itmc&data= + result.data');
    return Object.freeze({
        adapter: 'official-compat',
        platform: method,
        serviceName,
        instanceVariant: instance.id,
        instanceLabel: instance.label,
        commonMethod,
        parameters,
        expectedSteps: Object.freeze(plannedSteps(method, commonMethod, parameters)),
        urlRule
    });
}
