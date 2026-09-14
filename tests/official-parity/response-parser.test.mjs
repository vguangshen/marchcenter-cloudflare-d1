import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    OfficialSoapFaultError,
    OfficialSoapHttpError,
    OfficialSoapResponseError
} from '../../server/utils/officialCompat/errors.js';
import { parseSoapResponse } from '../../server/utils/officialCompat/soap/responseParser.js';
import { getSoapOperation } from '../../server/utils/officialCompat/soap/schemaRegistry.js';

const fixtures = JSON.parse(await readFile(new URL('./fixtures/axis-response-fixtures.json', import.meta.url), 'utf8'));
const operation = getSoapOperation('net', 'GetSystemInfo');

function responseXml(serializedResult, resultNode = operation.returnNodeName) {
    return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetSystemInfoResponse xmlns="http://tempuri.org/"><${resultNode}>${serializedResult}</${resultNode}></GetSystemInfoResponse></soap:Body></soap:Envelope>`;
}

test('HTTP non-success without Fault is a structured HTTP error', () => {
    assert.throws(
        () => parseSoapResponse({ status: 503, ok: false, body: '<html>offline</html>', operation }),
        error => error instanceof OfficialSoapHttpError && error.status === 503 && error.raw.includes('offline')
    );
});

test('SOAP Fault is distinct even when transported as HTTP 500', () => {
    assert.throws(
        () => parseSoapResponse({ status: 500, ok: false, body: fixtures.soapFault, operation }),
        error => error instanceof OfficialSoapFaultError
            && error.faultCode === 'soap:Server'
            && error.faultString === 'Mock fault'
    );
});

test('missing Result node is not converted to null', () => {
    const body = responseXml('{"code":10000,"succ":true}', 'AnotherResult');
    assert.throws(
        () => parseSoapResponse({ body, operation }),
        error => error instanceof OfficialSoapResponseError && error.code === 'OFFICIAL_SOAP_RESULT_MISSING'
    );
});

test('empty Result string is distinct from JSON null', () => {
    assert.throws(
        () => parseSoapResponse({ body: responseXml(''), operation }),
        error => error instanceof OfficialSoapResponseError && error.code === 'OFFICIAL_SOAP_RESULT_EMPTY'
    );
});

for (const [label, data] of [
    ['null', null],
    ['string', 'ticket'],
    ['object', { id: 1 }],
    ['array', ['a', 'b']]
]) {
    test(`valid Result JSON preserves data as ${label}`, () => {
        const serialized = JSON.stringify({ code: 10000, succ: true, message: 'ok', data });
        const result = parseSoapResponse({ body: responseXml(serialized), operation });
        assert.deepEqual(result.data, data);
        assert.equal(result.code, 10000);
        assert.equal(result.succ, true);
    });
}

test('invalid Result JSON preserves sanitized raw response', () => {
    assert.throws(
        () => parseSoapResponse({ body: fixtures.invalidResultJson, operation }),
        error => error instanceof OfficialSoapResponseError
            && error.code === 'OFFICIAL_SOAP_RESULT_INVALID_JSON'
            && error.raw === fixtures.invalidResultJson
    );
});

test('unknown XML structure fails explicitly and redacts credentials', () => {
    const body = '<root><Uname>secret-user</Uname><Password>secret-pass</Password></root>';
    assert.throws(() => parseSoapResponse({ body, operation }), error => {
        assert.equal(error.code, 'OFFICIAL_SOAP_UNKNOWN_STRUCTURE');
        assert.ok(!error.raw.includes('secret-user'));
        assert.ok(!error.raw.includes('secret-pass'));
        return true;
    });
});

