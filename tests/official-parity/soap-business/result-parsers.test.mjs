import assert from 'node:assert/strict';
import test from 'node:test';
import {
    OfficialResponseParseError,
    OfficialSoapFaultError
} from '../../../server/utils/officialCompat/errors.js';
import {
    BUSINESS_RESPONSE_EVIDENCE,
    parseAccountExistence,
    parseAccountMutation,
    parseGroupExistence,
    parseGroupMutation
} from '../../../server/utils/officialCompat/soap/adapters/resultParsers.js';
import { officialResult } from './helpers.mjs';

test('conflict branches retain captured evidence and cross-border AddGroup is static-derived', () => {
    assert.deepEqual(BUSINESS_RESPONSE_EVIDENCE, {
        IsGroupExisted: 'official-captured',
        IsStuExisted: 'official-captured',
        IsTeacherExisted: 'official-captured',
        AddTrainGroup: 'official-captured',
        AddAppraisalGroup: 'official-captured',
        AddMegagameGroup: 'official-captured',
        AddGroup: 'official-static-derived',
        AddStudent: 'official-captured',
        AddTeacher: 'official-captured'
    });
});

test('non-success Result remains a failure instead of absence', () => {
    const parsed = parseAccountExistence(
        'IsStuExisted',
        officialResult(null, { code: 10010, succ: false, message: '失败' })
    );
    assert.equal(parsed.status, 'failure');
    assert.equal(parsed.result.code, 10010);
    assert.equal(parsed.result.operationName, 'IsStuExisted');
    assert.equal(Object.prototype.propertyIsEnumerable.call(parsed.result, 'operationName'), false);
});

test('missing data is distinct from explicit null', () => {
    assert.throws(
        () => parseAccountExistence('IsStuExisted', { code: 10000, succ: true, message: '成功' }),
        error => error instanceof OfficialResponseParseError && error.dataKind === 'missing'
    );
    assert.throws(
        () => parseAccountExistence('IsStuExisted', officialResult(null)),
        error => error instanceof OfficialResponseParseError && error.dataKind === 'null'
    );
});

test('account existence accepts official JSON string arrays and already-parsed arrays', () => {
    assert.deepEqual(
        parseAccountExistence('IsStuExisted', officialResult('["学生甲"]')).accounts,
        ['学生甲']
    );
    assert.deepEqual(
        parseAccountExistence('IsTeacherExisted', officialResult(['教师甲'])).accounts,
        ['教师甲']
    );
});

test('single strings, objects and invalid JSON never become an empty array', () => {
    for (const data of ['student-1', '"student-1"', { id: 'student-1' }, '{bad-json}']) {
        assert.throws(
            () => parseAccountExistence('IsStuExisted', officialResult(data)),
            OfficialResponseParseError
        );
    }
});

test('official Fastjson semantics coerce non-string account array items', () => {
    assert.deepEqual(
        parseAccountExistence('IsStuExisted', officialResult([1, true, { x: 2 }, null])).accounts,
        ['1', 'true', '{"x":2}', null]
    );
});

test('group existence distinguishes null, empty string and group ID', () => {
    assert.deepEqual(
        { exists: parseGroupExistence(officialResult(null)).exists, groupID: parseGroupExistence(officialResult(null)).groupID },
        { exists: false, groupID: null }
    );
    assert.deepEqual(
        { exists: parseGroupExistence(officialResult('')).exists, groupID: parseGroupExistence(officialResult('')).groupID },
        { exists: false, groupID: '' }
    );
    assert.deepEqual(
        { exists: parseGroupExistence(officialResult('group-1')).exists, groupID: parseGroupExistence(officialResult('group-1')).groupID },
        { exists: true, groupID: 'group-1' }
    );
});

test('group creation parsers accept captured empty strings and object toString values', () => {
    for (const operation of ['AddTrainGroup', 'AddAppraisalGroup', 'AddMegagameGroup']) {
        assert.equal(parseGroupMutation(operation, officialResult('group-1')).groupID, 'group-1');
        assert.equal(parseGroupMutation(operation, officialResult('')).groupID, '');
        assert.equal(parseGroupMutation(operation, officialResult({ id: 'g' })).groupID, '{"id":"g"}');
        assert.throws(() => parseGroupMutation(operation, officialResult(null)), OfficialResponseParseError);
    }
});

test('account mutation parsers keep exact created account lists', () => {
    assert.deepEqual(parseAccountMutation('AddStudent', officialResult('["a","b"]')).accounts, ['a', 'b']);
    assert.deepEqual(parseAccountMutation('AddTeacher', officialResult(['t'])).accounts, ['t']);
});

test('sanitized parse errors retain raw evidence without passwords', () => {
    const response = {
        code: 10000,
        succ: true,
        message: '成功',
        data: { password: 'secret-value' }
    };
    assert.throws(
        () => parseAccountExistence('IsStuExisted', response),
        error => error instanceof OfficialResponseParseError
            && error.raw.includes('[REDACTED]')
            && !error.raw.includes('secret-value')
    );
});

test('SOAP Fault remains a transport-level structured exception', () => {
    const fault = new OfficialSoapFaultError('Mock fault', { raw: '<sanitized />' });
    assert.throws(() => { throw fault; }, error => error === fault && error.code === 'OFFICIAL_SOAP_FAULT');
});
