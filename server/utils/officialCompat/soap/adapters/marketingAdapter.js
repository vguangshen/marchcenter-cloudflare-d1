import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const MARKETING_SERVICE_NAME = 'ShichangyingxiaoshapanInterfaceUtilService';

export function createMarketingAdapter(options) {
    return createBaseSoapAdapter({
        ...options,
        serviceName: MARKETING_SERVICE_NAME,
        profileName: 'marketing'
    });
}
