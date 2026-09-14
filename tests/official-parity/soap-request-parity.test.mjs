import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildSoapActionHeader,
    buildSoapEnvelope,
    SOAP11_CONTENT_TYPE
} from '../../server/utils/officialCompat/soap/envelope.js';
import { buildConfirmedAxisEndpoint, getSoapOperation } from '../../server/utils/officialCompat/soap/schemaRegistry.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/axis-request-fixtures.json', import.meta.url), 'utf8'));
const credentials = { username: 'itmc', password: 'itmc' };
const cases = {
    'get-system-info': ['net', 'GetSystemInfo', {}],
    'is-group-existed-special': ['net', 'IsGroupExisted', { groupName: '中文&<>"\'', groupID: '' }],
    'array-null': ['net', 'IsTeacherExisted', { accountList: null }],
    'array-empty': ['net', 'IsTeacherExisted', { accountList: [] }],
    'array-one': ['net', 'IsTeacherExisted', { accountList: ['student-1'] }],
    'array-many-special': ['net', 'IsTeacherExisted', { accountList: ['学生&一', 'two<">'] }],
    'add-student-net-full': ['net', 'AddStudent', {
        studentList: [{ studentID: '学生&<1>', password: 'p"\'&<>', nickName: '昵称中文' }],
        groupID: 'group&1', st: 1700000000000, ed: 1700003600000, startExam: true
    }],
    'add-student-net-null-fields': ['net', 'AddStudent', {
        studentList: [{ studentID: 'student-null', password: null, nickName: null }],
        groupID: 'g', st: 1, ed: 2, startExam: false
    }],
    'add-student-commerce': ['commerce', 'AddStudent', {
        studentList: [{ studentID: 'c-1', password: 'pw', nickName: '网店' }],
        groupID: 'cg', st: 33, ed: 44, maxRunYear: 2, autoDeal: false
    }],
    'begin-media-ad-commerce': ['commerce', 'BeginMediaAd', { GroupID: 'G&<>"\'中文', ntime: 7 }]
};

for (const fixture of fixtures) {
    test(`${fixture.name} is byte-for-byte equal to the captured Axis request`, () => {
        const [profileName, operationName, parameters] = cases[fixture.name];
        const operation = getSoapOperation(profileName, operationName);
        const xml = buildSoapEnvelope({ profileName, operationName, parameters, credentials });
        assert.equal(xml, fixture.xml);
        assert.equal(buildSoapActionHeader(operation), fixture.soapAction);
        assert.equal(SOAP11_CONTENT_TYPE, fixture.contentType);
        assert.equal(buildConfirmedAxisEndpoint('http://127.0.0.1:18080'), fixture.endpoint);
    });
}

test('undefined required parameters remain distinct from null and empty values', () => {
    assert.throws(
        () => buildSoapEnvelope({
            profileName: 'net',
            operationName: 'IsTeacherExisted',
            parameters: {},
            credentials
        }),
        error => error?.code === 'OFFICIAL_SOAP_SCHEMA_ERROR' && /accountList/.test(error.message)
    );
});

test('every schema long serializer preserves Java long maximum decimal text exactly', () => {
    const maximum = '9223372036854775807';
    const cases = [
        ['net', 'AddStudent', {
            studentList: [], groupID: 'g', st: maximum, ed: maximum, startExam: true
        }],
        ['net', 'StartExam', { groupID: 'g', st: maximum, ed: maximum }],
        ['net', 'ResetStuEndTime', { studentID: 's', endTime: maximum }],
        ['marketing', 'AddStudent', {
            studentList: [], groupID: 'g', st: maximum, ed: maximum, maxRunYear: 0, autoDeal: false
        }],
        ['marketing', 'ResetStuEndTime', { studentID: 's', endTime: maximum }],
        ['commerce', 'AddStudent', {
            studentList: [], groupID: 'g', st: maximum, ed: maximum, maxRunYear: 0, autoDeal: false
        }],
        ['commerce', 'ResetStuEndTime', { studentID: 's', endTime: maximum }]
    ];
    for (const [profileName, operationName, parameters] of cases) {
        const xml = buildSoapEnvelope({ profileName, operationName, parameters, credentials });
        assert.match(xml, new RegExp(maximum));
        assert.doesNotMatch(xml, /9223372036854776000/);
    }
});

test('unsafe Number input cannot silently round a SOAP long', () => {
    assert.throws(
        () => buildSoapEnvelope({
            profileName: 'net',
            operationName: 'ResetStuEndTime',
            parameters: { studentID: 's', endTime: 9223372036854776000 },
            credentials
        }),
        error => error?.code === 'OFFICIAL_SOAP_SCHEMA_ERROR' && /long/.test(error.message)
    );
});
