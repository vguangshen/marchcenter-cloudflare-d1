import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNetExpertJumpUrl, buildNetExpertPayload } from '../../server/utils/officialCompat/net/expertJump.js';
import { createNetAdapter } from '../../server/utils/officialCompat/soap/adapters/netAdapter.js';
import { resolveNetExpertTicket } from '../../server/utils/officialCompat/expertStudentBinding.js';

const BASE = 'http://127.0.0.1:9289/DS50108';

test('.NET legacy evaluator URL matches the recovered JSON contract', () => {
    const url = new URL(buildNetExpertJumpUrl(BASE, {
        expertName: 'mcee2e-admin',
        userName: 'mcse2e-admin1'
    }));
    assert.equal(url.pathname, '/DS50108/login.aspx');
    assert.equal(url.searchParams.get('op'), 'expertlogin');
    assert.deepEqual(JSON.parse(url.searchParams.get('expertuserdata')), {
        ServerConfig: 'itmc',
        ExpertName: 'mcee2e-admin',
        UserName: 'mcse2e-admin1'
    });
});

test('.NET open evaluator URL keeps optional taskIds separate from expertuserdata', () => {
    const url = new URL(buildNetExpertJumpUrl(BASE, {
        entryMode: 'open',
        taskIds: 'task-1,task-2',
        serverConfig: 'itmc',
        expertName: 'mcee2e-admin',
        userName: 'mcse2e-admin1'
    }));
    assert.equal(url.pathname, '/DS50108/open/toExpertPage');
    assert.equal(url.searchParams.get('taskIds'), 'task-1,task-2');
    assert.deepEqual(JSON.parse(url.searchParams.get('expertuserdata')), {
        ServerConfig: 'itmc',
        ExpertName: 'mcee2e-admin',
        UserName: 'mcse2e-admin1'
    });
});

test('NET evaluator payload rejects protocol-breaking evaluator names', () => {
    assert.throws(
        () => buildNetExpertPayload({ expertName: 'bad=name', userName: 'student-1' }),
        /评委账号长度需为 2–64 位/
    );
    assert.throws(
        () => buildNetExpertJumpUrl(`${BASE}/`, { expertName: 'judge-1', userName: 'student-1' }),
        { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' }
    );
});

test('.NET evaluator resolves the vendor remote ticket for exactly one selected student', async () => {
    const requests = [];
    const remoteTicket = encodeURIComponent(JSON.stringify({
        ServerConfig: 'itmc',
        ExpertName: 'judge-1',
        UserName: 'student-3'
    }));
    const redirectUrl = await resolveNetExpertTicket({
        baseUrl: BASE,
        config: { allowHttp: true },
        expertName: 'judge-1',
        studentAccountName: 'student-3',
        fetchImplementation: async request => {
            requests.push(new URL(typeof request === 'string' ? request : request.url));
            return Response.json({
                code: 10010,
                succ: true,
                data: JSON.stringify([{ username: 'student-3', data: remoteTicket }])
            });
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].pathname, '/DS50108/login.aspx');
    assert.equal(requests[0].searchParams.get('op'), 'loaduserscore');
    assert.equal(requests[0].searchParams.get('usernames'), 'student-3');
    assert.equal(requests[0].searchParams.get('expertname'), 'judge-1');
    const redirect = new URL(redirectUrl);
    assert.equal(redirect.searchParams.get('op'), 'expertlogin');
    assert.deepEqual(JSON.parse(redirect.searchParams.get('expertuserdata')), {
        ServerConfig: 'itmc',
        ExpertName: 'judge-1',
        UserName: 'student-3'
    });
});

test('.NET evaluator rejects a remote response that does not contain the selected student', async () => {
    await assert.rejects(() => resolveNetExpertTicket({
        baseUrl: BASE,
        config: { allowHttp: true },
        expertName: 'judge-1',
        studentAccountName: 'student-3',
        fetchImplementation: async () => Response.json({
            code: 10010,
            succ: true,
            data: JSON.stringify([{ username: 'student-1', data: 'ticket' }])
        })
    }), /student-3/);
});

test('NET adapter exposes the exact ExpertStatus(data, sKey) SOAP operation', async () => {
    const requests = [];
    const soapResult = JSON.stringify({ code: 10000, succ: true, message: '成功', data: 'ready' })
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const adapter = createNetAdapter({
        baseUrl: BASE,
        credentials: { username: 'soap-user', password: 'soap-password' },
        fetchImplementation: async (endpoint, options) => {
            requests.push({ endpoint, ...options });
            return new Response(
                `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ExpertStatusResponse xmlns="http://tempuri.org/"><ExpertStatusResult>${soapResult}</ExpertStatusResult></ExpertStatusResponse></soapenv:Body></soapenv:Envelope>`,
                { status: 200, headers: { 'Content-Type': 'text/xml; charset=utf-8' } }
            );
        }
    });

    const result = await adapter.expertStatus({ data: 'enciphered-date', sKey: 'vendor-key' });
    assert.equal(result.data, 'ready');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].endpoint, `${BASE}/normwebservice.asmx?WSDL`);
    assert.equal(requests[0].headers.SOAPAction, '"http://tempuri.org/ExpertStatus"');
    assert.match(requests[0].body, /<ExpertStatus xmlns="http:\/\/tempuri\.org\/">/);
    assert.match(requests[0].body, /<data>enciphered-date<\/data><sKey>vendor-key<\/sKey>/);
});
