import crypto from 'crypto';
import { OfficialAdapterParameterError, OfficialJumpConfigError } from '../errors.js';

const RSA_CHUNK_SIZE = 117;
export const PAAS_V2_ANSWER_TYPE = '1';

function toPublicKeyPem(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.includes('BEGIN PUBLIC KEY')) return text;
    const compact = text.replace(/\s+/g, '');
    const lines = compact.match(/.{1,64}/g) || [];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

function required(value, label) {
    if (value === undefined || value === null || value === '') {
        throw new OfficialAdapterParameterError(`paasV2 缺少参数 ${label}`, {
            details: { parameter: label }
        });
    }
    return value;
}

export function encryptRsaChunks(text, publicKeyPem) {
    required(text, '待加密文本');
    required(publicKeyPem, 'publicKey');
    const source = Buffer.from(text, 'utf8');
    const key = {
        key: toPublicKeyPem(publicKeyPem),
        padding: crypto.constants.RSA_PKCS1_PADDING
    };
    const blocks = [];
    for (let offset = 0; offset < source.length; offset += RSA_CHUNK_SIZE) {
        blocks.push(crypto.publicEncrypt(key, source.subarray(offset, offset + RSA_CHUNK_SIZE)));
    }
    return Buffer.concat(blocks).toString('base64');
}

function parseJson(text, operationName) {
    if (!text) throw new OfficialJumpConfigError('paasV2 接口返回为空', {
        code: 'PAAS_V2_RESPONSE_EMPTY', stage: operationName
    });
    try {
        return JSON.parse(text);
    } catch {
        throw new OfficialJumpConfigError('paasV2 接口返回不是有效 JSON', {
            code: 'PAAS_V2_RESPONSE_JSON_ERROR', stage: operationName
        });
    }
}

export function buildPaasV2ExternalTokenInfo(parameters, config = {}) {
    const timestamp = Date.now();
    const answerType = PAAS_V2_ANSWER_TYPE;
    const softwareUnique = String(parameters.softwareUnique || '');
    const userName = parameters.loginName
        || `${config.studentPrefix || 'mcs'}${parameters.userName || parameters.currentLoginName || ''}${parameters.studentSuffix ?? config.studentSuffix ?? '1'}`;
    const className = parameters.className || `${config.classPrefix || 'mc'}${parameters.teacherUserName || parameters.userName || ''}`;
    const teacherName = parameters.teacherUserName || `${config.teacherPrefix || 'mc'}${parameters.userName || parameters.currentLoginName || ''}`;

    const tokenInfo = {
        userName: `${userName}_${answerType}_${softwareUnique}`,
        nickName: parameters.userName || '',
        teacherName: `${teacherName}_${answerType}_${softwareUnique}`,
        teacherNickName: parameters.userName || '',
        className: `${className}_${answerType}_${softwareUnique}`,
        userType: '2',
        timestamp,
        mode: Number(config.mode || parameters.mode || 1)
    };
    return tokenInfo;
}

function simulatedPhoneFor(identity) {
    const text = String(identity || '0');
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const prefix = ['13','14','15','16','17','18','19'][hash % 7];
    const suffix = String(hash >>> 0).padStart(9, '0').slice(-9);
    return `${prefix}${suffix}`;
}

function buildPaasV2TaskParameters(parameters, config) {
    return {
        taskId: String(config.plugFlag || parameters.plugFlag || ''),
        answerType: Number(PAAS_V2_ANSWER_TYPE)
    };
}

export function buildPaasV2JumpData(parameters, config = {}, context = {}) {
    return {
        returnUrl: String(config.returnUrl || context.returnUrl || parameters.returnUrl || ''),
        productID: String(config.productId || parameters.productId || 'PT04'),
        productModuleID: String(parameters.productModuleId || parameters.softwareUnique || ''),
        productUserId: (() => {
            const identity = `MC${parameters.currentLoginName || parameters.userName || ''}`;
            const phone = simulatedPhoneFor(String(parameters.userId || identity || 'marchcenter'));
            const segment = String(config.userTypeSegment || 'STU');
            const moduleId = String(parameters.softwareUnique || parameters.productModuleId || '');
            return `${phone}-${segment}-${identity}_${moduleId}`;
        })(),
        productTeacherAccount: String(parameters.teacherUserName || config.productTeacherAccount || ''),
        ...buildPaasV2TaskParameters(parameters, config)
    };
}

function jsonBodyWithStringData(dataObject) {
    return JSON.stringify({ data: JSON.stringify(dataObject) });
}

function parseTaskResultData(data, operationName) {
    const value = typeof data === 'string' ? (data.trim() ? parseJson(data, operationName) : null) : data;
    if (value == null) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    throw new OfficialJumpConfigError('paasV2 任务结果格式无效', {
        code: 'PAAS_V2_TASK_DATA_INVALID',
        stage: operationName
    });
}

function parseScore(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const score = Number(value);
    return Number.isFinite(score) && score >= 0 ? score : null;
}

function getTaskDisplayScore(data) {
    const objective = parseScore(data?.objScore);
    const subjective = parseScore(data?.subScore);
    const score = objective !== null || subjective !== null
        ? (objective ?? 0) + (subjective ?? 0)
        : parseScore(data?.score);
    return score === null ? null : Math.round(Math.min(score, 100) * 100) / 100;
}

export function selectPaasV2PublicKeys(config) {
    const tempKey = config.tempKey && typeof config.tempKey === 'object'
        ? config.tempKey
        : (typeof config.tempKey === 'string' && config.tempKey ? safeParseTempKey(config.tempKey) : null);
    const { publicKey, applicationPublicKey } = tempKey || {};
    if (typeof publicKey === 'string' && publicKey.trim()
        && typeof applicationPublicKey === 'string' && applicationPublicKey.trim()) {
        return { issuerPublicKey: publicKey, applicationPublicKey };
    }
    return {
        issuerPublicKey: String(config.externalPublicKey || ''),
        applicationPublicKey: String(config.publicKey || '')
    };
}

export function createPaasV2Adapter(options = {}) {
    const config = options.config || {};
    const apiBaseUrl = String(config.apiBaseUrl || config.officialBaseUrl || '').replace(/\/+$/, '');
    const jumpBaseUrl = String(config.jumpBaseUrl || config.trainJumpPath || '');
    const { issuerPublicKey, applicationPublicKey } = selectPaasV2PublicKeys(config);
    if (!apiBaseUrl) throw new OfficialAdapterParameterError('paasV2 缺少 apiBaseUrl/trainPath');
    if (!jumpBaseUrl) throw new OfficialAdapterParameterError('paasV2 缺少 jumpBaseUrl/trainJumpPath');
    const fetchImplementation = options.fetchImplementation;
    if (typeof fetchImplementation !== 'function') throw new TypeError('paasV2 fetchImplementation 必须注入');

    const encryptForPlatform = text => encryptRsaChunks(text, issuerPublicKey);
    const tokenStore = options.tokenStore;

    async function getPlatformToken(parameters, authenticatedUserId, rejectedToken) {
        const { timestamp, ...identity } = buildPaasV2ExternalTokenInfo(parameters, config);
        const cacheKey = tokenStore && authenticatedUserId != null && authenticatedUserId !== ''
            ? crypto.createHash('sha256').update(JSON.stringify([
                apiBaseUrl, jumpBaseUrl, String(authenticatedUserId), issuerPublicKey, applicationPublicKey, identity
            ])).digest('hex')
            : null;
        if (cacheKey !== null) {
            const cached = tokenStore.get(cacheKey);
            if (cached !== null && cached !== rejectedToken) return cached;
            if (cached !== null) tokenStore.delete(cacheKey);
        }

        if (!applicationPublicKey.trim()) throw new OfficialAdapterParameterError('paasV2 缺少 publicKey/applicationPublicKey');
        const ticket = encryptForPlatform(JSON.stringify({ ...identity, timestamp }));
        const body = jsonBodyWithStringData({ ticket, publicKey: applicationPublicKey });
        const response = await fetchImplementation(`${apiBaseUrl}/GetTokenInfo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        if (!response.ok) {
            throw new OfficialJumpConfigError('paasV2 GetTokenInfo 请求失败', {
                code: 'PAAS_V2_TOKEN_HTTP_FAILURE',
                stage: 'GetTokenInfo',
                details: { httpStatus: response.status }
            });
        }
        const text = await response.text();
        const result = parseJson(text, 'GetTokenInfo');
        if (String(result.code) !== '10000' || typeof result.data !== 'string' || result.data.length === 0) {
            throw new OfficialJumpConfigError('paasV2 GetTokenInfo 返回失败', {
                code: 'PAAS_V2_TOKEN_RESULT_FAILURE',
                stage: 'GetTokenInfo'
            });
        }
        if (cacheKey !== null) tokenStore.set(cacheKey, result.data);
        return result.data;
    }

    async function buildJumpForm(parameters, context = {}) {
        const jumpData = buildPaasV2JumpData(parameters, config, context);
        const data = encryptForPlatform(JSON.stringify(jumpData));
        const platformToken = await getPlatformToken(parameters, context.user?.id);
        return {
            action: jumpBaseUrl,
            method: 'POST',
            fields: {
                data,
                platformToken
            }
        };
    }

    function postTaskOperation(operationName, params, platformToken) {
        const data = JSON.stringify(params);
        const timestamp = Date.now();
        const sign = encryptForPlatform(JSON.stringify({ data, timestamp }));
        return fetchImplementation(`${apiBaseUrl}/${operationName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                platformToken,
                sign
            },
            body: JSON.stringify({ data })
        });
    }

    async function readTaskOperation(operationName, params, platformToken) {
        const response = await postTaskOperation(operationName, params, platformToken);
        if (!response.ok) {
            throw new OfficialJumpConfigError('paasV2 任务查询请求失败', {
                code: 'PAAS_V2_TASK_HTTP_FAILURE',
                stage: operationName,
                details: { httpStatus: response.status }
            });
        }
        const result = parseJson(await response.text(), operationName);
        if (String(result?.code) === '10011') {
            throw new OfficialJumpConfigError('paasV2 任务查询令牌已过期', {
                code: 'PAAS_V2_TASK_TOKEN_EXPIRED',
                stage: operationName
            });
        }
        if (operationName === 'GetTaskState' && String(result?.message || '').includes('任务不存在')
            && String(result?.code) !== '10000') {
            return { finish: 2 };
        }
        if (String(result?.code) !== '10000') {
            throw new OfficialJumpConfigError('paasV2 平台未返回任务结果', {
                code: 'PAAS_V2_TASK_RESULT_FAILURE',
                stage: operationName
            });
        }
        return parseTaskResultData(result.data, operationName);
    }

    async function getTaskResult(parameters, context = {}) {
        const authenticatedUserId = required(context.user?.id, 'user.id');
        const params = buildPaasV2TaskParameters(parameters, config);
        required(params.taskId.trim(), 'taskId');

        let platformToken = await getPlatformToken(parameters, authenticatedUserId);
        let refreshed = false;
        const read = async operationName => {
            try {
                return await readTaskOperation(operationName, params, platformToken);
            } catch (error) {
                if (error.code !== 'PAAS_V2_TASK_TOKEN_EXPIRED' || refreshed) throw error;
                refreshed = true;
                platformToken = await getPlatformToken(parameters, authenticatedUserId, platformToken);
                return readTaskOperation(operationName, params, platformToken);
            }
        };
        const state = await read('GetTaskState');
        switch (String(state?.finish)) {
        case '1': {
            const grade = await read('GetTrainingScore');
            const score = getTaskDisplayScore(grade);
            return { status: score === null ? 'scoring' : 'completed', score };
        }
        case '2':
            return { status: 'in_progress', score: null };
        case '3':
            return { status: 'scoring', score: null };
        default:
            throw new OfficialJumpConfigError('paasV2 任务完成状态无效', {
                code: 'PAAS_V2_TASK_STATE_INVALID',
                stage: 'GetTaskState'
            });
        }
    }

    async function resetTaskData(parameters) {
        const platformToken = await getPlatformToken(parameters);
        const params = {
            taskId: String(config.plugFlag || parameters.plugFlag || ''),
            answerType: PAAS_V2_ANSWER_TYPE
        };
        const response = await postTaskOperation('ResetTaskData', params, platformToken);
        if (!response.ok) {
            throw new OfficialJumpConfigError('paasV2 ResetTaskData 请求失败', {
                code: 'PAAS_V2_RESET_HTTP_FAILURE',
                stage: 'ResetTaskData',
                details: { httpStatus: response.status }
            });
        }
        const result = parseJson(await response.text(), 'ResetTaskData');
        if (String(result?.code) !== '10000') {
            throw new OfficialJumpConfigError('paasV2 ResetTaskData 返回失败', {
                code: 'PAAS_V2_RESET_RESULT_FAILURE',
                stage: 'ResetTaskData'
            });
        }
        return true;
    }

    return Object.freeze({
        apiBaseUrl,
        jumpBaseUrl,
        buildJumpForm,
        getTaskResult,
        resetTaskData
    });
}

function safeParseTempKey(value) {
    try { return JSON.parse(value); }
    catch { return null; }
}
