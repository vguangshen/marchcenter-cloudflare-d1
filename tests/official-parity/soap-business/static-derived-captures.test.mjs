import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildSoapActionHeader,
    buildSoapEnvelope,
    SOAP11_CONTENT_TYPE
} from '../../../server/utils/officialCompat/soap/envelope.js';
import { getSoapOperation } from '../../../server/utils/officialCompat/soap/schemaRegistry.js';

const FIXTURES = [
    {
        file: 'official-management-accounting-captures.json',
        profile: 'managementAccounting',
        service: 'GuanlikuaijiGJshapanInterfaceUtilService',
        contract: {
            operationName: 'AddStudent',
            javaSignature: 'String addStudent(StudentBaseClass[], String, long, long, int, boolean)',
            parameterNames: ['studentList', 'groupID', 'st', 'ed', 'maxRunYear', 'autoDeal'],
            parameterTypes: ['ArrayOfStudentBaseClass', 'string', 'long', 'long', 'int', 'boolean']
        }
    },
    {
        file: 'official-cross-border-commerce-captures.json',
        profile: 'crossBorderCommerce',
        service: 'KuajingdianshangshapanInterfaceUtilService',
        contract: {
            operationName: 'AddStudent',
            javaSignature: 'String addStudent(StudentBaseClass[], String, long, long, boolean)',
            parameterNames: ['studentList', 'groupID', 'st', 'ed', 'startExam'],
            parameterTypes: ['ArrayOfStudentBaseClass', 'string', 'long', 'long', 'boolean']
        }
    },
    {
        file: 'official-enterprise-management-captures.json',
        profile: 'enterpriseManagement',
        service: 'QiyeguanlishapanInterfaceUtilService',
        contract: {
            operationName: 'AddStudent',
            javaSignature: 'String addStudent(StudentBaseClass[], String, long, long, int, boolean)',
            parameterNames: ['studentList', 'groupID', 'st', 'ed', 'maxRunYear', 'autoDeal'],
            parameterTypes: ['ArrayOfStudentBaseClass', 'string', 'long', 'long', 'int', 'boolean']
        }
    }
];

const OFFICIAL_JAR_SHA256 = '4f71c19237e9735276fc5c97de426fb03ee09962f7af3bc4984a01df5d4ce88e';
const capturedCredentials = { username: '[REDACTED]', password: '[REDACTED]' };

async function loadFixture(profile) {
    return JSON.parse(await readFile(
        new URL(`./fixtures/${profile.file}`, import.meta.url),
        'utf8'
    ));
}

for (const profile of FIXTURES) {
    const fixture = await loadFixture(profile);

    test(`${profile.profile} official capture freezes the Axis contract`, () => {
        assert.equal(fixture.evidenceLevel, 'official-captured');
        assert.equal(fixture.localhostOnly, true);
        assert.equal(fixture.productionTraffic, false);
        assert.equal(fixture.artifactSha256, OFFICIAL_JAR_SHA256);
        assert.equal(fixture.scenarioCount, 22);
        assert.equal(fixture.scenarios.length, 22);
        assert.deepEqual(fixture.redactions, ['clientinfo.Uname', 'clientinfo.Password']);
        for (const captured of fixture.scenarios) {
            assert.equal(captured.evidenceLevel, 'official-captured');
            for (const call of captured.calls) {
                assert.match(call.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/normwebservice\.asmx\?WSDL$/);
                assert.equal(call.fallbackResponse, false);
                const header = call.requestXml.match(/<soapenv:Header>[\s\S]*?<\/soapenv:Header>/)?.[0];
                assert.ok(header, `${captured.name} 缺少 SOAP Header`);
                assert.match(header, /<Uname>\[REDACTED\]<\/Uname>/);
                assert.match(header, /<Password>\[REDACTED\]<\/Password>/);
            }
        }
        assert.deepEqual(fixture.contract, {
            ...profile.contract,
            soapAction: `http://tempuri.org/${profile.contract.operationName}`,
            returnNodeName: `${profile.contract.operationName}Result`
        });
        const operation = getSoapOperation(profile.profile, 'AddStudent');
        assert.deepEqual(operation.parameters.map(({ name, type }) => [name, type]), profile.contract.parameterNames.map((name, index) => [name, profile.contract.parameterTypes[index]]));
        assert.equal(operation.soapAction, fixture.contract.soapAction);
        assert.equal(operation.returnNodeName, fixture.contract.returnNodeName);
    });

    test(`${profile.profile} direct stub XML is byte-for-byte equal to official Axis`, () => {
        for (const captured of fixture.scenarios) {
            if (captured.invocationKind !== 'official-axis-stub-direct') continue;
            assert.equal(captured.calls.length, 1, `${captured.name} 直调场景应只有一次调用`);
            const call = captured.calls[0];
            const xml = buildSoapEnvelope({
                profileName: profile.profile,
                operationName: call.operationName,
                parameters: captured.input,
                credentials: capturedCredentials
            });
            assert.equal(xml, call.requestXml, `${profile.profile} ${captured.name} 请求 XML 与官方 Axis 不一致`);
            assert.equal(call.headers['Content-Type'], SOAP11_CONTENT_TYPE);
            assert.equal(call.headers.SOAPAction, buildSoapActionHeader(getSoapOperation(profile.profile, call.operationName)));
            assert.equal(captured.outcome.type, 'return');
            assert.deepEqual(captured.unusedMockResponses, {});
        }
    });

    test(`${profile.profile} training entrance drives the official operation sequence`, () => {
        const groupOps = {
            managementAccounting: new Set(['AddTrainGroup', 'AddAppraisalGroup', 'AddMegagameGroup']),
            enterpriseManagement: new Set(['AddTrainGroup', 'AddAppraisalGroup', 'AddMegagameGroup']),
            crossBorderCommerce: new Set(['AddGroup', 'AddMegagameGroup'])
        }[profile.profile];
        for (const captured of fixture.scenarios) {
            if (captured.invocationKind !== 'training-entrance') continue;
            assert.equal(captured.outcome.type, 'return', `${captured.name} 高层流程应成功返回票据`);
            const wrapped = JSON.parse(String(captured.outcome.raw || ''));
            assert.equal(wrapped.code, 10000, `${captured.name} 应返回 code 10000`);
            assert.equal(wrapped.succ, true, `${captured.name} 应返回 succ true`);
            assert.match(String(wrapped.data), /^[0-9A-F]+$/, `${captured.name} data 应为十六进制票据`);
            const sequence = captured.operationSequence;
            assert.equal(sequence[0], 'IsGroupExisted');
            assert.equal(sequence.at(-2), 'IsStuExisted');
            assert.equal(sequence.at(-1), 'AddStudent');
            const groupOp = sequence[1];
            assert.ok(groupOps.has(groupOp), `${captured.name} 建班操作 ${groupOp} 不在 profile 建班集合中`);
            assert.deepEqual(sequence, [sequence[0], groupOp, sequence.at(-2), sequence.at(-1)]);
            for (const call of captured.calls) {
                assert.equal(call.headers['Content-Type'], SOAP11_CONTENT_TYPE);
                assert.match(call.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/normwebservice\.asmx\?WSDL$/);
            }
            assert.deepEqual(captured.unusedMockResponses, {});
        }
    });

    test(`${profile.profile} zero/false and Java long maximum remain exact on the wire`, () => {
        const scenarioNames = {
            managementAccounting: ['add-student-max-zero-auto-false', 'add-student-long-maximum'],
            enterpriseManagement: ['add-student-max-zero-auto-false', 'add-student-long-maximum'],
            crossBorderCommerce: ['add-student-start-exam-false', 'add-student-long-maximum']
        }[profile.profile];
        const [zeroName, maximumName] = scenarioNames;
        const zero = fixture.scenarios.find(item => item.name === zeroName).calls[0].requestXml;
        if (profile.profile === 'crossBorderCommerce') {
            assert.match(zero, /<startExam>false<\/startExam>/);
            assert.doesNotMatch(zero, /<startExam>true<\/startExam>/);
        } else {
            assert.match(zero, /<maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
            assert.doesNotMatch(zero, /<maxRunYear>10<\/maxRunYear>|<autoDeal>true<\/autoDeal>/);
        }
        const maximum = fixture.scenarios.find(item => item.name === maximumName).calls[0].requestXml;
        assert.match(maximum, /<st>9223372036854775807<\/st>/);
        assert.match(maximum, /<ed>9223372036854775807<\/ed>/);
        assert.doesNotMatch(maximum, /9223372036854776000/);
    });

    test(`${profile.profile} null optional bean fields are omitted rather than serialized as empty or nil`, () => {
        const captured = fixture.scenarios.find(item => item.name === 'add-student-null-optional');
        const xml = captured.calls[0].requestXml;
        const beanXml = xml.match(/<StudentBaseClass>[\s\S]*?<\/StudentBaseClass>/)?.[0];
        assert.equal(beanXml, '<StudentBaseClass><StudentID>student-null</StudentID></StudentBaseClass>');
        assert.doesNotMatch(beanXml, /<Password|<NickName|xsi:nil/);
    });
}
