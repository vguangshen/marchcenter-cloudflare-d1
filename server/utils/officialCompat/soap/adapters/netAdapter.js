import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const NET_SERVICE_NAME = 'NetGeneralStandardInterfaceUtilService';

export function createNetAdapter(options) {
    const adapter = createBaseSoapAdapter({
        ...options,
        serviceName: NET_SERVICE_NAME,
        profileName: 'net'
    });
    return Object.freeze({
        ...adapter,
        // This is the exact NetGeneralStandardInterfaceUtilService method
        // recovered from the vendor client: ExpertStatus(data, sKey). It is
        // intentionally explicit because the values are platform-issued and
        // must not be fabricated from the evaluator URL.
        expertStatus(values = {}) {
            if (!values || typeof values !== 'object' || Array.isArray(values)) {
                throw new TypeError('ExpertStatus 参数必须是对象');
            }
            const data = values.data === undefined || values.data === null ? '' : values.data;
            const sKey = values.sKey === undefined || values.sKey === null ? '' : values.sKey;
            if (typeof data !== 'string' || typeof sKey !== 'string') {
                throw new TypeError('ExpertStatus 的 data 和 sKey 必须是字符串');
            }
            return adapter.callOperation('ExpertStatus', { data, sKey });
        }
    });
}
