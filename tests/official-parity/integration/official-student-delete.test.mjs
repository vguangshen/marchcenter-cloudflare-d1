import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteOfficialStudent } from '../../../server/utils/officialCompat/officialStudentLifecycle.js';
import { createOfficialTokenStore } from '../../../server/utils/officialCompat/tokenStore.js';

const BASE = 'https://vendor.invalid/DS';
const context = { cardUrl: BASE };

test('official JAVA deletion uses tokenInfo then delStudentDataQueue', async () => {
    const urls = [];
    const fetchImplementation = async (url, options) => {
        urls.push({ url: String(url), body: options.body });
        if (String(url).endsWith('/tokenInfo')) {
            return Response.json({ code: 10000, succ: true, message: '成功', data: 'TOKEN' });
        }
        return Response.json({ code: 10000, succ: true, message: '成功', data: true });
    };
    const result = await deleteOfficialStudent({ method: 'java' }, context, 'student-2', {
        fetchImplementation,
        tokenStore: createOfficialTokenStore(),
        credentialsProvider: { getCredentials: async () => ({ tokenNum: 'N', password: 'P' }) }
    });
    assert.deepEqual(urls.map(item => item.url), [
        `${BASE}/open/tokenInfo`, `${BASE}/open/delStudentDataQueue`
    ]);
    assert.equal(urls[1].body, 'u=student-2');
    assert.equal(result.operation, 'delStudentDataQueue');
});

test('official SOAP deletion uses the selected new profile MarkStuDeleted operation', async () => {
    const requests = [];
    const fetchImplementation = async (url, options) => {
        requests.push({ url: String(url), action: options.headers.SOAPAction, body: options.body });
        const result = JSON.stringify({ code: 10000, succ: true, message: '成功', data: ['student-2'] });
        return new Response(
            `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><MarkStuDeletedResponse xmlns="http://tempuri.org/"><MarkStuDeletedResult>${result}</MarkStuDeletedResult></MarkStuDeletedResponse></soapenv:Body></soapenv:Envelope>`,
            { headers: { 'content-type': 'text/xml; charset=utf-8' } }
        );
    };
    const result = await deleteOfficialStudent({ method: 'managementAccounting' }, context, 'student-2', {
        fetchImplementation,
        tokenStore: createOfficialTokenStore(),
        credentialsProvider: { getCredentials: async () => ({ username: 'U', password: 'P' }) }
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, `${BASE}/normwebservice.asmx?WSDL`);
    assert.equal(requests[0].action, '"http://tempuri.org/MarkStuDeleted"');
    assert.match(requests[0].body, /<studentIDList><string>student-2<\/string><\/studentIDList>/);
    assert.equal(result.operation, 'MarkStuDeleted');
});
