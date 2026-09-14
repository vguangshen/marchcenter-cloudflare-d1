import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const COMMERCE_SERVICE_NAME = 'WangdianyunyingtuiguangGJshapanInterfaceUtilService';

export function createCommerceAdapter(options) {
    return createBaseSoapAdapter({
        ...options,
        serviceName: COMMERCE_SERVICE_NAME,
        profileName: 'commerce'
    });
}
