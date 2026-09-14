import { createOfficialAdapter } from './adapterRegistry.js';
import { OfficialJumpExecutionError } from './errors.js';
import {
    resolveOfficialPlatform,
    selectOfficialBaseUrl,
    validateConfirmedOfficialBaseUrl
} from './officialJumpConfig.js';

const SUCCESS = 10000;
const TOKEN_INVALID = 10011;
const MAX_TOKEN_ATTEMPTS = 3;

/**
 * Module initialization (reinitializeSystem) is JAVA-only: the management
 * platform calls NewTrainingInterfaceUtilService.reinitializeSystem with an
 * empty body, which wipes every class/account/score on that training platform
 * instance. No default accounts are re-created (that is the management
 * platform's separate createClassUsers step).
 */
export async function initializeOfficialModule(config, context, dependencies) {
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    if (method !== 'java') {
        const error = new OfficialJumpExecutionError('当前接入方式不支持模块初始化', {
            code: 'OFFICIAL_MODULE_INIT_UNSUPPORTED'
        });
        error.status = 400;
        throw error;
    }
    const baseUrl = validateConfirmedOfficialBaseUrl(selectOfficialBaseUrl(config, context));
    const credentials = await dependencies.credentialsProvider.getCredentials({ method, config });
    const adapter = createOfficialAdapter(serviceName, {
        baseUrl,
        fetchImplementation: dependencies.fetchImplementation,
        tokenStore: dependencies.tokenStore,
        credentials,
        timeoutMs: dependencies.timeoutMs,
        maxResponseBytes: dependencies.maxResponseBytes
    });
    if (typeof adapter.reinitializeModule !== 'function') {
        const error = new OfficialJumpExecutionError('当前 official 适配器未实现模块初始化', {
            code: 'OFFICIAL_MODULE_INIT_UNSUPPORTED'
        });
        error.status = 400;
        throw error;
    }

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
        let outcome;
        try {
            outcome = await adapter.reinitializeModule();
        } catch (cause) {
            if (cause?.code === 'OFFICIAL_JAVA_TIMEOUT') {
                const error = new OfficialJumpExecutionError(
                    '初始化系统等待平台响应超时，平台可能仍在处理中，请稍后确认后再重试',
                    { code: 'OFFICIAL_MODULE_INIT_TIMEOUT', cause }
                );
                error.status = 504;
                throw error;
            }
            throw cause;
        }
        if (Number(outcome.result?.code) === TOKEN_INVALID) {
            dependencies.tokenStore.delete(`${baseUrl}/open`);
            continue;
        }
        if (!outcome.initialized || !outcome.result || Number(outcome.result.code) !== SUCCESS) {
            const error = new OfficialJumpExecutionError(
                `模块初始化失败（平台返回 code ${outcome.result?.code ?? 'unknown'}）`,
                {
                    code: 'OFFICIAL_MODULE_INIT_FAILED',
                    details: {
                        method,
                        serviceName,
                        resultCode: outcome.result?.code ?? null
                    }
                }
            );
            error.status = 502;
            throw error;
        }
        return Object.freeze({ initialized: true });
    }
    const error = new OfficialJumpExecutionError('模块初始化连续三次返回 Token 失效', {
        code: 'OFFICIAL_MODULE_INIT_TOKEN_EXHAUSTED'
    });
    error.status = 502;
    throw error;
}
