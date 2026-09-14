import crypto from 'crypto';
import { OfficialAdapterParameterError, OfficialJumpConfigError } from '../errors.js';

const RSA_CHUNK_SIZE = 117;

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
    } catch (cause) {
        throw new OfficialJumpConfigError('paasV2 接口返回不是有效 JSON', {
            code: 'PAAS_V2_RESPONSE_JSON_ERROR', stage: operationName, cause
        });
    }
}

export function buildPaasV2ExternalTokenInfo(parameters, config = {}) {
    const timestamp = Date.now();
    const answerType = String(config.answerType || parameters.answerType || '1');
    const softwareUnique = String(parameters.softwareUnique || '');
    const student = parameters.loginRole !== 'teacher';
    const userName = parameters.loginName
        || (student ? `${config.studentPrefix || 'mcs'}${parameters.userName || parameters.currentLoginName || ''}${parameters.studentSuffix ?? config.studentSuffix ?? '1'}`
                    : `${config.teacherPrefix || 'mc'}${parameters.userName || parameters.currentLoginName || ''}`);
    const className = parameters.className || `${config.classPrefix || 'mc'}${parameters.teacherUserName || parameters.userName || ''}`;
    const teacherName = parameters.teacherUserName || `${config.teacherPrefix || 'mc'}${parameters.userName || parameters.currentLoginName || ''}`;

    const tokenInfo = {
        userName: student ? `${userName}_${answerType}_${softwareUnique}` : userName,
        nickName: parameters.userName || '',
        teacherName: student ? `${teacherName}_${answerType}_${softwareUnique}` : teacherName,
        teacherNickName: parameters.userName || '',
        className: `${className}_${answerType}_${softwareUnique}`,
        userType: student ? '2' : '1',
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
        taskId: String(config.plugFlag || parameters.plugFlag || ''),
        answerType: String(config.answerType || parameters.answerType || '1')
    };
}

function jsonBodyWithStringData(dataObject) {
    return JSON.stringify({ data: JSON.stringify(dataObject) });
}

export function createPaasV2Adapter(options = {}) {
    const config = options.config || {};
    const apiBaseUrl = String(config.apiBaseUrl || config.officialBaseUrl || '');
    const jumpBaseUrl = String(config.jumpBaseUrl || config.trainJumpPath || '');
    const externalPublicKey = String(config.externalPublicKey || '');
    const tempKey = config.tempKey && typeof config.tempKey === 'object'
        ? config.tempKey
        : (typeof config.tempKey === 'string' && config.tempKey ? safeParseTempKey(config.tempKey) : null);
    if (!apiBaseUrl) throw new OfficialAdapterParameterError('paasV2 缺少 apiBaseUrl/trainPath');
    if (!jumpBaseUrl) throw new OfficialAdapterParameterError('paasV2 缺少 jumpBaseUrl/trainJumpPath');
    const fetchImplementation = options.fetchImplementation;
    if (typeof fetchImplementation !== 'function') throw new TypeError('paasV2 fetchImplementation 必须注入');

    const encryptForPlatform = text => {
        if (tempKey?.publicKey) return encryptRsaChunks(text, tempKey.publicKey);
        if (externalPublicKey) return encryptRsaChunks(text, externalPublicKey);
        throw new OfficialAdapterParameterError('paasV2 缺少 externalPublicKey 或 tempKey.publicKey');
    };

    async function getPlatformToken(parameters) {
        const tokenInfo = buildPaasV2ExternalTokenInfo(parameters, config);
        const ticket = encryptRsaChunks(JSON.stringify(tokenInfo), tempKey?.publicKey || externalPublicKey);
        const publicKey = tempKey?.applicationPublicKey || config.publicKey || '';
        if (!publicKey) throw new OfficialAdapterParameterError('paasV2 缺少 publicKey/applicationPublicKey');

        const body = jsonBodyWithStringData({ ticket, publicKey });
        const response = await fetchImplementation(`${apiBaseUrl}/GetTokenInfo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        const text = await response.text();
        const result = parseJson(text, 'GetTokenInfo');
        if (String(result.code) !== '10000' || typeof result.data !== 'string' || result.data.length === 0) {
            throw new OfficialJumpConfigError('paasV2 GetTokenInfo 返回失败', {
                code: 'PAAS_V2_TOKEN_RESULT_FAILURE',
                stage: 'GetTokenInfo',
                raw: text.slice(0, 500)
            });
        }
        return result.data;
    }

    async function buildJumpForm(parameters, context = {}) {
        const platformToken = await getPlatformToken(parameters);
        const jumpData = buildPaasV2JumpData(parameters, config, context);
        const data = encryptForPlatform(JSON.stringify(jumpData));
        return {
            action: jumpBaseUrl,
            method: 'POST',
            fields: {
                data,
                platformToken
            }
        };
    }

    async function resetTaskData(parameters) {
        const platformToken = await getPlatformToken(parameters);
        const params = {
            taskId: String(config.plugFlag || parameters.plugFlag || ''),
            answerType: String(config.answerType || parameters.answerType || '1')
        };
        const timestamp = Date.now();
        const signObj = {
            data: JSON.stringify(params),
            timestamp
        };
        const sign = encryptForPlatform(JSON.stringify(signObj));
        const body = JSON.stringify({ data: JSON.stringify(params) });
        const response = await fetchImplementation(`${apiBaseUrl}/ResetTaskData`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                platformToken,
                sign
            },
            body
        });
        const text = await response.text();
        const result = parseJson(text, 'ResetTaskData');
        if (String(result.code) !== '10000') {
            throw new OfficialJumpConfigError('paasV2 ResetTaskData 返回失败', {
                code: 'PAAS_V2_RESET_RESULT_FAILURE',
                stage: 'ResetTaskData',
                raw: text.slice(0, 500)
            });
        }
        return true;
    }

    return Object.freeze({
        apiBaseUrl,
        jumpBaseUrl,
        buildJumpForm,
        resetTaskData
    });
}

function safeParseTempKey(value) {
    try { return JSON.parse(value); }
    catch { return null; }
}
