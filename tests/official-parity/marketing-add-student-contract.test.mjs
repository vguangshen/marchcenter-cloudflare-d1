import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createMarketingAdapter } from '../../server/utils/officialCompat/soap/adapters/marketingAdapter.js';
import {
    buildSoapActionHeader,
    buildSoapEnvelope,
    SOAP11_CONTENT_TYPE
} from '../../server/utils/officialCompat/soap/envelope.js';
import { getSoapOperation } from '../../server/utils/officialCompat/soap/schemaRegistry.js';
import { createAxisSoapClient } from '../../server/utils/officialCompat/soap/soapClient.js';

const fixture = JSON.parse(await readFile(
    new URL('./soap-business/fixtures/official-marketing-add-student-captures.json', import.meta.url),
    'utf8'
));
const capturedCredentials = { username: '[REDACTED]', password: '[REDACTED]' };

function scenario(name) {
    const found = fixture.scenarios.find(item => item.name === name);
    assert.ok(found, `缺少 official-captured marketing 场景 ${name}`);
    return found;
}

function addStudentCall(name) {
    const call = scenario(name).calls.find(item => item.operationName === 'AddStudent');
    assert.ok(call, `${name} 未发送 AddStudent`);
    return call;
}

test('official marketing capture freezes the six-parameter Axis contract', () => {
    assert.equal(fixture.evidenceLevel, 'official-captured');
    assert.equal(fixture.localhostOnly, true);
    assert.equal(fixture.productionTraffic, false);
    assert.equal(fixture.scenarioCount, 11);
    assert.equal(fixture.scenarios.length, 11);
    for (const captured of fixture.scenarios) {
        assert.equal(captured.evidenceLevel, 'official-captured');
        for (const call of captured.calls) {
            assert.match(call.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/normwebservice\.asmx\?WSDL$/);
            assert.equal(call.fallbackResponse, false);
            const header = call.requestXml.match(/<soapenv:Header>[\s\S]*?<\/soapenv:Header>/)?.[0];
            assert.ok(header);
            assert.match(header, /<Uname>\[REDACTED\]<\/Uname>/);
            assert.match(header, /<Password>\[REDACTED\]<\/Password>/);
        }
    }
    assert.deepEqual(fixture.contract, {
        operationName: 'AddStudent',
        javaSignature: 'String addStudent(StudentBaseClass[], String, long, long, int, boolean)',
        parameterNames: ['studentList', 'groupID', 'st', 'ed', 'maxRunYear', 'autoDeal'],
        parameterTypes: ['ArrayOfStudentBaseClass', 'string', 'long', 'long', 'int', 'boolean'],
        soapAction: 'http://tempuri.org/AddStudent',
        returnNodeName: 'AddStudentResult'
    });
    const operation = getSoapOperation('marketing', 'AddStudent');
    assert.deepEqual(operation.parameters.map(({ name, type }) => [name, type]), [
        ['studentList', 'ArrayOfStudentBaseClass'], ['groupID', 'string'],
        ['st', 'long'], ['ed', 'long'], ['maxRunYear', 'int'], ['autoDeal', 'boolean']
    ]);
    assert.equal(operation.soapAction, fixture.contract.soapAction);
    assert.equal(operation.returnNodeName, fixture.contract.returnNodeName);
});

for (const name of [
    'max-zero-auto-false',
    'max-ten-auto-true',
    'times-zero',
    'long-maximum',
    'multiple-students',
    'chinese-and-xml-special',
    'null-optional-fields'
]) {
    test(`${name} TypeScript XML is byte-for-byte equal to official Axis`, () => {
        const captured = scenario(name);
        const call = addStudentCall(name);
        const xml = buildSoapEnvelope({
            profileName: 'marketing',
            operationName: 'AddStudent',
            parameters: captured.input,
            credentials: capturedCredentials
        });
        assert.equal(xml, call.requestXml);
        assert.equal(call.headers['Content-Type'], SOAP11_CONTENT_TYPE);
        assert.equal(call.headers.SOAPAction, buildSoapActionHeader(getSoapOperation('marketing', 'AddStudent')));
        assert.match(call.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/normwebservice\.asmx\?WSDL$/);
        assert.equal(call.fallbackResponse, false);
        assert.equal(captured.outcome.type, 'return');
        assert.deepEqual(captured.unusedMockResponses, {});
    });
}

test('zero, false and Java long maximum remain exact on the wire', () => {
    const zeroXml = addStudentCall('max-zero-auto-false').requestXml;
    assert.match(zeroXml, /<maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
    assert.doesNotMatch(zeroXml, /<maxRunYear>10<\/maxRunYear>|<autoDeal>true<\/autoDeal>/);

    const maximumXml = addStudentCall('long-maximum').requestXml;
    assert.match(maximumXml, /<st>9223372036854775807<\/st>/);
    assert.match(maximumXml, /<ed>9223372036854775807<\/ed>/);
    assert.doesNotMatch(maximumXml, /9223372036854776000/);
});

test('null optional bean fields are omitted rather than serialized as empty or nil', () => {
    const xml = addStudentCall('null-optional-fields').requestXml;
    const beanXml = xml.match(/<StudentBaseClass>[\s\S]*?<\/StudentBaseClass>/)?.[0];
    assert.equal(beanXml, '<StudentBaseClass><StudentID>student-null</StudentID></StudentBaseClass>');
    assert.doesNotMatch(beanXml, /<Password|<NickName|xsi:nil/);
});

test('official high-level invalid maxRunYear inputs fail at the captured stages', () => {
    for (const name of ['max-null', 'max-missing']) {
        const captured = scenario(name);
        assert.deepEqual(captured.operationSequence, ['IsGroupExisted', 'IsStuExisted']);
        assert.equal(captured.outcome.type, 'exception');
        assert.equal(captured.calls.some(call => call.operationName === 'AddStudent'), false);
    }
    for (const name of ['max-string-zero', 'max-string-invalid']) {
        const captured = scenario(name);
        assert.deepEqual(captured.operationSequence, []);
        assert.equal(captured.outcome.type, 'exception');
        assert.equal(captured.outcome.exceptionChain[0].class, 'java.lang.IllegalArgumentException');
    }
});

function soapResult(operationName, result) {
    const escaped = JSON.stringify(result)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    return `<?xml version="1.0" encoding="utf-8"?>`
        + `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">`
        + `<soapenv:Body><${operationName}Response xmlns="http://tempuri.org/">`
        + `<${operationName}Result>${escaped}</${operationName}Result>`
        + `</${operationName}Response></soapenv:Body></soapenv:Envelope>`;
}

test('marketingAdapter through the real Axis client sends all six parameters', async () => {
    const requests = [];
    const results = {
        IsGroupExisted: { code: 10000, succ: true, message: 'ok', data: 'group-1' },
        IsStuExisted: { code: 10000, succ: true, message: 'ok', data: '[]' },
        AddStudent: { code: 10000, succ: true, message: 'ok', data: '["student-1"]' }
    };
    const fetchImplementation = async (endpoint, options) => {
        const operationName = options.headers.SOAPAction.match(/\/([^/"]+)"$/)?.[1];
        assert.ok(operationName && results[operationName]);
        requests.push({ endpoint, ...options, operationName });
        return new Response(soapResult(operationName, results[operationName]), {
            status: 200,
            headers: { 'Content-Type': SOAP11_CONTENT_TYPE }
        });
    };
    const soapClient = createAxisSoapClient({
        fetchImplementation,
        credentials: capturedCredentials
    });
    const adapter = createMarketingAdapter({
        soapClient,
        baseUrl: 'http://127.0.0.1:18080',
        ticketBuilder: () => 'unused'
    });
    const result = await adapter.commonCheckTrain({
        loginName: 'student-1',
        className: 'class-local',
        startTime: '1',
        endTime: '2',
        userId: '1',
        userName: 'Student One',
        classType: 1,
        maxRunYear: 0,
        autoDeal: false
    });
    assert.equal(result.code, 10000);
    assert.deepEqual(requests.map(request => request.operationName), [
        'IsGroupExisted', 'IsStuExisted', 'AddStudent'
    ]);
    const addStudent = requests.at(-1);
    assert.equal(addStudent.endpoint, 'http://127.0.0.1:18080/normwebservice.asmx?WSDL');
    assert.match(addStudent.body, /<st>1<\/st><ed>2<\/ed><maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
    assert.equal((addStudent.body.match(/<autoDeal>/g) || []).length, 1);
});

test('marketing requires autoDeal while false remains distinct from missing', () => {
    assert.throws(
        () => buildSoapEnvelope({
            profileName: 'marketing',
            operationName: 'AddStudent',
            parameters: {
                studentList: [], groupID: 'g', st: '0', ed: '0', maxRunYear: 0
            },
            credentials: capturedCredentials
        }),
        error => error?.code === 'OFFICIAL_SOAP_SCHEMA_ERROR' && /autoDeal/.test(error.message)
    );
    assert.match(buildSoapEnvelope({
        profileName: 'marketing',
        operationName: 'AddStudent',
        parameters: {
            studentList: [], groupID: 'g', st: '0', ed: '0', maxRunYear: 0, autoDeal: false
        },
        credentials: capturedCredentials
    }), /<autoDeal>false<\/autoDeal>/);
});
