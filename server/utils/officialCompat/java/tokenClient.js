import {
    OfficialJavaHttpError,
    OfficialJavaResponseError,
    OfficialJavaTokenError,
    OfficialJavaTransportError
} from '../errors.js';
import { OFFICIAL_SUCCESS } from '../resultCodec.js';
import { parseJavaResult, requireJavaResultData } from './javaResultParser.js';

export const JAVA_TOKEN_ATTEMPTS = 3;

export function createPlatformCredentialHeader(credentials) {
    if (!credentials || credentials.password === undefined || credentials.tokenNum === undefined) {
        throw new OfficialJavaTokenError('JAVA 平台凭据必须安全注入 password 和 tokenNum', {
            code: 'OFFICIAL_JAVA_CREDENTIALS_REQUIRED'
        });
    }
    // Captured FastJSON/HashMap wire order is password followed by tokenNum.
    return JSON.stringify({
        password: String(credentials.password),
        tokenNum: String(credentials.tokenNum)
    });
}

export function createJavaTokenClient(options = {}) {
    const { openBaseUrl, tokenStore, transport, credentials } = options;
    if (!openBaseUrl) throw new TypeError('openBaseUrl 必填');
    if (!tokenStore || typeof tokenStore.get !== 'function' || typeof tokenStore.set !== 'function') {
        throw new TypeError('tokenStore 必须显式注入');
    }
    if (!transport || typeof transport.post !== 'function') throw new TypeError('transport 必须显式注入');
    const credentialHeader = createPlatformCredentialHeader(credentials);

    return Object.freeze({
        cacheKey: openBaseUrl,
        clear() {
            tokenStore.delete(openBaseUrl);
        },
        async getToken() {
            const cached = tokenStore.get(openBaseUrl);
            if (cached !== null && cached !== '') return cached;

            let lastFailure = null;
            for (let attempt = 1; attempt <= JAVA_TOKEN_ATTEMPTS; attempt += 1) {
                let raw;
                try {
                    raw = await transport.post({
                        openBaseUrl,
                        operationName: 'tokenInfo',
                        platformToken: credentialHeader,
                        values: {}
                    });
                } catch (cause) {
                    if (cause instanceof OfficialJavaHttpError || cause instanceof OfficialJavaTransportError) {
                        lastFailure = cause;
                        continue;
                    }
                    throw cause;
                }
                if (raw === '') {
                    lastFailure = new OfficialJavaTokenError('获取实训软件 token 失败，返回信息为空', {
                        code: 'OFFICIAL_JAVA_TOKEN_EMPTY_RESPONSE', raw
                    });
                    continue;
                }
                const result = parseJavaResult(raw, 'tokenInfo');
                if (result.code !== OFFICIAL_SUCCESS) {
                    lastFailure = new OfficialJavaTokenError(`获取实训软件 token 失败: ${result.message}`, {
                        code: 'OFFICIAL_JAVA_TOKEN_RESULT_FAILURE', raw
                    });
                    continue;
                }
                const token = requireJavaResultData(result, 'tokenInfo');
                if (typeof token !== 'string') {
                    throw new OfficialJavaResponseError('tokenInfo.data 必须是字符串', {
                        operationName: 'tokenInfo', raw, code: 'OFFICIAL_JAVA_TOKEN_DATA_TYPE'
                    });
                }
                tokenStore.set(openBaseUrl, token);
                return token;
            }
            throw new OfficialJavaTokenError('获取实训软件 token 三次失败', {
                cause: lastFailure,
                code: 'OFFICIAL_JAVA_TOKEN_RETRIES_EXHAUSTED',
                details: { attempts: JAVA_TOKEN_ATTEMPTS }
            });
        }
    });
}
