import { createBaseSoapAdapter } from './baseSoapAdapter.js';

export const MANAGEMENT_ACCOUNTING_SERVICE_NAME = 'GuanlikuaijiGJshapanInterfaceUtilService';

export function createManagementAccountingAdapter(options) {
    return createBaseSoapAdapter({
        ...options,
        serviceName: MANAGEMENT_ACCOUNTING_SERVICE_NAME,
        profileName: 'managementAccounting'
    });
}
