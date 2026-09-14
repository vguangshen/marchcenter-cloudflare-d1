import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const ENTERPRISE_MANAGEMENT_SERVICE_NAME = 'QiyeguanlishapanInterfaceUtilService';

export function createEnterpriseManagementAdapter(options) {
    return createBaseSoapAdapter({
        ...options,
        serviceName: ENTERPRISE_MANAGEMENT_SERVICE_NAME,
        profileName: 'enterpriseManagement'
    });
}
