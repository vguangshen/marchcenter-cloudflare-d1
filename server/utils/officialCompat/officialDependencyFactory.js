import { createOfficialTokenStore } from './tokenStore.js';
import { OfficialJumpConfigError } from './errors.js';
import { getEnv } from '../../config/runtime.js';
import { createOfficialSafeFetch } from './safeTransport.js';

function requiredCredential(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialJumpConfigError(`${label}未通过安全配置注入`, {
            code: 'OFFICIAL_CREDENTIALS_REQUIRED',
            stage: 'credentials'
        });
    }
    return value;
}

export function createConfigCredentialsProvider() {
    return Object.freeze({
        async getCredentials({ method, config }) {
            if (method === 'java') {
                return {
                    tokenNum: requiredCredential(
                        config.tokenNumber || getEnv('ITMC_PLATFORM_TOKEN_NUMBER') || getEnv('TOKEN_NUMBER_VERIFICATION_SOFT'),
                        'JAVA tokenNumber'
                    ),
                    password: requiredCredential(
                        config.tokenPassword || getEnv('ITMC_PLATFORM_TOKEN_PASSWORD') || getEnv('PASSWORD_VERIFICATION_SOFT'),
                        'JAVA tokenPassword'
                    )
                };
            }
            if (['net', 'marketing', 'commerce', 'managementAccounting',
                'crossBorderCommerce', 'enterpriseManagement'].includes(method)) {
                return {
                    username: requiredCredential(config.soapUsername || getEnv('SOAP_CLIENT_USERNAME'), 'SOAP username'),
                    password: requiredCredential(config.soapPassword || getEnv('SOAP_CLIENT_PASSWORD'), 'SOAP password')
                };
            }
            return null;
        }
    });
}

function noOpLogger() {
    return Object.freeze({
        info() {},
        error(metadata) {
            // The executor only passes its fixed, redacted metadata shape here.
            // Keeping this visible makes production-route failures diagnosable
            // without ever logging credentials, request bodies or tickets.
            console.error('[official-compat]', metadata);
        }
    });
}

/** Creates all request-independent official dependencies without hidden module state. */
export function createOfficialDependencyFactory(options = {}) {
    const clock = options.clock || Date.now;
    const fetchImplementation = options.fetchImplementation || (options.baseUrl
        ? createOfficialSafeFetch({
            baseUrl: options.baseUrl,
            allowHttp: options.allowHttp === true,
            timeoutMs: options.timeoutMs,
            maxResponseBytes: options.maxResponseBytes
        })
        : globalThis.fetch);
    const logger = options.logger || noOpLogger();
    const credentialsProvider = options.credentialsProvider || createConfigCredentialsProvider();
    if (typeof clock !== 'function') throw new TypeError('clock 必须是函数');
    if (typeof fetchImplementation !== 'function') throw new TypeError('fetchImplementation 必须是函数');
    if (!logger || typeof logger.error !== 'function') throw new TypeError('logger.error 必须是函数');
    if (!credentialsProvider || typeof credentialsProvider.getCredentials !== 'function') {
        throw new TypeError('credentialsProvider.getCredentials 必须是函数');
    }
    const tokenStore = options.tokenStore || createOfficialTokenStore({ now: clock });
    return Object.freeze({
        fetchImplementation,
        tokenStore,
        clock,
        credentialsProvider,
        logger,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes,
        trainingEntrance: options.trainingEntrance
    });
}
