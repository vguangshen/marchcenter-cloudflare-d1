import assert from 'node:assert/strict';
import test from 'node:test';
import { createAxisSoapClient } from '../../server/utils/officialCompat/soap/soapClient.js';

test('Axis client sends the strict request through an injected mock transport', async () => {
    let captured;
    const fetchImplementation = async (url, init) => {
        captured = { url, init };
        const result = JSON.stringify({ code: 10000, succ: true, message: 'ok', data: ['one'] });
        const body = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><IsTeacherExistedResponse xmlns="http://tempuri.org/"><IsTeacherExistedResult>${result}</IsTeacherExistedResult></IsTeacherExistedResponse></soap:Body></soap:Envelope>`;
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
    };
    const client = createAxisSoapClient({
        fetchImplementation,
        credentials: { username: 'itmc', password: 'itmc' }
    });

    const result = await client.call({
        profileName: 'net',
        operationName: 'IsTeacherExisted',
        baseUrl: 'http://127.0.0.1:18080',
        parameters: { accountList: ['one'] }
    });

    assert.equal(captured.url, 'http://127.0.0.1:18080/normwebservice.asmx?WSDL');
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers['Content-Type'], 'text/xml; charset=utf-8');
    assert.equal(captured.init.headers.SOAPAction, '"http://tempuri.org/IsTeacherExisted"');
    assert.match(captured.init.body, /<accountList><string>one<\/string><\/accountList>/);
    assert.deepEqual(result.data, ['one']);
});

