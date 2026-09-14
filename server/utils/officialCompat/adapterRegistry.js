import { OfficialAdapterMethodError } from './errors.js';
import { createCommerceAdapter, COMMERCE_SERVICE_NAME } from './soap/adapters/commerceAdapter.js';
import { createMarketingAdapter, MARKETING_SERVICE_NAME } from './soap/adapters/marketingAdapter.js';
import { createNetAdapter, NET_SERVICE_NAME } from './soap/adapters/netAdapter.js';
import {
    createManagementAccountingAdapter,
    MANAGEMENT_ACCOUNTING_SERVICE_NAME
} from './soap/adapters/managementAccountingAdapter.js';
import {
    createCrossBorderCommerceAdapter,
    CROSS_BORDER_COMMERCE_SERVICE_NAME
} from './soap/adapters/crossBorderCommerceAdapter.js';
import {
    createEnterpriseManagementAdapter,
    ENTERPRISE_MANAGEMENT_SERVICE_NAME
} from './soap/adapters/enterpriseManagementAdapter.js';
import { createNewTrainingAdapter, NEW_TRAINING_SERVICE_NAME } from './java/newTrainingAdapter.js';

export const IMPLEMENTED_OFFICIAL_COMMON_METHODS = Object.freeze([
    'commonReturnTargetId',
    'commonGetLoginName',
    'commonCheckTrain',
    'commonCheckTrainWithTeacher',
    'commonReturnStudentBaseInfo',
    'commonReturnTeacherBaseInfo'
]);

export const UNIMPLEMENTED_OFFICIAL_COMMON_METHODS = Object.freeze([
    'commonFindOnlineTraining',
    'commonGetExamPaperScore',
    'commonGetStudentTagNameScoreStr',
    'commonGetStudentTagNameScore',
    'commonGetTheoreticalScore',
    'commonGetTrainReport',
    'commonGetTaskCollect',
    'commonResetExamineData',
    'commonResetEndExamTime',
    'commonGetOnlineCount',
    'commonGetStuTheoryDoneInfo',
    'commonGetStuTrainDoneInfo',
    'commonMarkStudentDeleted',
    'commonChangePaper',
    'commonStartBackup',
    'commonGetBackupedFileUrl',
    'commonStartHTMLBackup',
    'commonGetHTMLBackupedFileUrl'
]);

const ADAPTER_FACTORIES = Object.freeze({
    [NET_SERVICE_NAME]: createNetAdapter,
    [MARKETING_SERVICE_NAME]: createMarketingAdapter,
    [COMMERCE_SERVICE_NAME]: createCommerceAdapter,
    [MANAGEMENT_ACCOUNTING_SERVICE_NAME]: createManagementAccountingAdapter,
    [CROSS_BORDER_COMMERCE_SERVICE_NAME]: createCrossBorderCommerceAdapter,
    [ENTERPRISE_MANAGEMENT_SERVICE_NAME]: createEnterpriseManagementAdapter,
    [NEW_TRAINING_SERVICE_NAME]: createNewTrainingAdapter
});

export function listOfficialAdapterServices() {
    return Object.keys(ADAPTER_FACTORIES);
}

export function getOfficialMethodStatus(methodName) {
    if (IMPLEMENTED_OFFICIAL_COMMON_METHODS.includes(methodName)) return 'implemented';
    if (UNIMPLEMENTED_OFFICIAL_COMMON_METHODS.includes(methodName)) return 'not-implemented';
    return 'not-allowed';
}

export function createOfficialAdapter(serviceName, options) {
    const factory = ADAPTER_FACTORIES[serviceName];
    if (!factory) {
        throw new OfficialAdapterMethodError(`未注册官方适配器: ${serviceName}`, {
            code: 'OFFICIAL_ADAPTER_SERVICE_NOT_ALLOWED',
            details: { serviceName }
        });
    }
    return factory(options);
}
