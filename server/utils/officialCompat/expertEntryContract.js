/**
 * The evaluator entry is a vendor-side provisioning workflow, not a local
 * alias for the MarchCenter student account.
 *
 * The Java contract is recovered from the original InterfaceController:
 * /{raceId}/open/toExpertPage calls getExpertName(), which calls createExpert
 * (userType = 4) and then ExpertService.doInitExpert() for the selected
 * student's module record. The browser must follow the URL so the vendor
 * session created by that controller is retained.
 *
 * The generic .NET SOAP contract contains ExpertStatus only; it has no
 * evaluator-create operation. Its legacy browser entry is retained here as a
 * separate contract and is deliberately reported as vendor-defined until the
 * target .NET handler is verified to provision missing evaluator users.
 */
export function getExpertEntryContract(method, entryMode = 'legacy') {
    if (method === 'java') {
        return Object.freeze({
            method: 'java',
            entry: 'open/toExpertPage',
            remoteProvisioning: 'vendor-entry',
            createsIndependentAccount: true,
            accountRole: 4,
            association: 'ExpertService.doInitExpert'
        });
    }
    if (method === 'net') {
        return Object.freeze({
            method: 'net',
            entry: entryMode === 'open' ? 'open/toExpertPage' : 'login.aspx?op=expertlogin',
            remoteProvisioning: 'vendor-defined',
            createsIndependentAccount: null,
            accountRole: null,
            association: 'vendor-defined'
        });
    }
    return Object.freeze({
        method: String(method || ''),
        entry: '',
        remoteProvisioning: 'unsupported',
        createsIndependentAccount: false,
        accountRole: null,
        association: 'unsupported'
    });
}
