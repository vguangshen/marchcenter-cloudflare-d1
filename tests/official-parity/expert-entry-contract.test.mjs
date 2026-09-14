import assert from 'node:assert/strict';
import test from 'node:test';
import { getExpertEntryContract } from '../../server/utils/officialCompat/expertEntryContract.js';

test('Java evaluator entry records the recovered remote create-and-associate workflow', () => {
    assert.deepEqual(getExpertEntryContract('java'), {
        method: 'java',
        entry: 'open/toExpertPage',
        remoteProvisioning: 'vendor-entry',
        createsIndependentAccount: true,
        accountRole: 4,
        association: 'ExpertService.doInitExpert'
    });
});

test('.NET evaluator entry does not claim a missing SOAP create operation', () => {
    assert.deepEqual(getExpertEntryContract('net'), {
        method: 'net',
        entry: 'login.aspx?op=expertlogin',
        remoteProvisioning: 'vendor-defined',
        createsIndependentAccount: null,
        accountRole: null,
        association: 'vendor-defined'
    });
});
