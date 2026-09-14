import {
    createOfficialAdapter,
    getOfficialMethodStatus
} from './adapterRegistry.js';
import { OfficialAdapterMethodError } from './errors.js';
import { mapOfficialJumpParameters } from './jumpParamMapper.js';
import { executeWithOfficialRetry } from './retryPolicy.js';

export function lowerCaseInitial(value) {
    if (value === null || value === undefined || value === '') return value;
    const text = String(value);
    return text.slice(0, 1).toLowerCase() + text.slice(1);
}

export function createTrainingEntrance(options = {}) {
    const adapterFactory = options.adapterFactory || createOfficialAdapter;
    const clearToken = options.clearToken || (() => undefined);
    if (typeof adapterFactory !== 'function') throw new TypeError('adapterFactory 必须是函数');
    if (typeof clearToken !== 'function') throw new TypeError('clearToken 必须是函数');

    return Object.freeze({
        async executeNew({ serviceName, methodName, parameters, url, adapterOptions = {} }) {
            const normalizedMethodName = lowerCaseInitial(methodName);
            const status = getOfficialMethodStatus(normalizedMethodName);
            if (status === 'not-implemented') {
                throw new OfficialAdapterMethodError(`官方方法尚未实现: ${normalizedMethodName}`, {
                    code: 'OFFICIAL_ADAPTER_METHOD_NOT_IMPLEMENTED',
                    details: { serviceName, methodName: normalizedMethodName }
                });
            }
            if (status !== 'implemented') {
                throw new OfficialAdapterMethodError(`官方方法不在白名单: ${normalizedMethodName}`, {
                    details: { serviceName, methodName: normalizedMethodName }
                });
            }
            const mapped = mapOfficialJumpParameters(normalizedMethodName, parameters);
            // accountWasReady is MarchCenter execution state, not an official
            // interface parameter. Keep it out of the public parameter schema,
            // but carry the positive marker into the Java adapter so a repaired
            // account can skip duplicate synchronization and only refresh its
            // per-entry ticket.
            if (parameters?.accountWasReady === true) mapped.accountWasReady = true;
            return executeWithOfficialRetry(async attempt => {
                const adapter = adapterFactory(serviceName, {
                    ...adapterOptions,
                    baseUrl: url,
                    attempt
                });
                const method = adapter[normalizedMethodName];
                if (typeof method !== 'function') {
                    throw new OfficialAdapterMethodError(
                        `${serviceName} 未实现白名单方法 ${normalizedMethodName}`,
                        { code: 'OFFICIAL_ADAPTER_METHOD_NOT_IMPLEMENTED' }
                    );
                }
                return method(mapped);
            }, {
                clearToken: async (attempt, result) => {
                    const key = `${url}/open`;
                    if (adapterOptions.tokenStore?.delete) adapterOptions.tokenStore.delete(key);
                    return clearToken({
                        key,
                        attempt,
                        result,
                        serviceName,
                        methodName: normalizedMethodName
                    });
                }
            });
        }
    });
}
