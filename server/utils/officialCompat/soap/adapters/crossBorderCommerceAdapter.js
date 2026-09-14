import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const CROSS_BORDER_COMMERCE_SERVICE_NAME = 'KuajingdianshangshapanInterfaceUtilService';

export function createCrossBorderCommerceAdapter(options) {
    return createBaseSoapAdapter({
        ...options,
        serviceName: CROSS_BORDER_COMMERCE_SERVICE_NAME,
        profileName: 'crossBorderCommerce'
    });
}
