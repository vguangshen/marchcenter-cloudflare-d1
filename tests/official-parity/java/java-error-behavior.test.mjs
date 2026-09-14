import assert from 'node:assert/strict';
import test from 'node:test';
import { createJavaHttpTransport } from '../../../server/utils/officialCompat/java/javaHttpTransport.js';
import { adapterWithPlan, ok, studentParameters, tokenSuccess } from './helpers.mjs';

test('HTTP non-success, network failure and timeout are distinct structured errors', async () => {
    const http = createJavaHttpTransport({ fetchImplementation: async () => new Response('bad', { status: 503 }) });
    await assert.rejects(http.post({ openBaseUrl: 'https://x/open', operationName: 'getUserName', platformToken: 'x', values: {} }), { code: 'OFFICIAL_JAVA_HTTP_ERROR', status: 503 });
    const network = createJavaHttpTransport({ fetchImplementation: async () => { throw new TypeError('network'); } });
    await assert.rejects(network.post({ openBaseUrl: 'https://x/open', operationName: 'getUserName', platformToken: 'x', values: {} }), { code: 'OFFICIAL_JAVA_TRANSPORT_ERROR' });
    const timeout = createJavaHttpTransport({ timeoutMs: 5, fetchImplementation: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })))) });
    await assert.rejects(timeout.post({ openBaseUrl: 'https://x/open', operationName: 'getUserName', platformToken: 'x', values: {} }), { code: 'OFFICIAL_JAVA_TIMEOUT' });
});

test('JAVA transport rejects declared and actual responses above the configured bound', async () => {
    const declared = createJavaHttpTransport({
        maxResponseBytes: 4,
        fetchImplementation: async () => new Response('small', { headers: { 'Content-Length': '20' } })
    });
    await assert.rejects(declared.post({
        openBaseUrl: 'https://x/open', operationName: 'getUserName', platformToken: 'x', values: {}
    }), { code: 'OFFICIAL_JAVA_RESPONSE_TOO_LARGE' });
    const actual = createJavaHttpTransport({
        maxResponseBytes: 4,
        fetchImplementation: async () => ({
            ok: true, status: 200, headers: new Headers(), text: async () => '12345'
        })
    });
    await assert.rejects(actual.post({
        openBaseUrl: 'https://x/open', operationName: 'getUserName', platformToken: 'x', values: {}
    }), { code: 'OFFICIAL_JAVA_RESPONSE_TOO_LARGE' });
});

test('missing code/succ and malformed JSON never become success or empty collections', async () => {
    for (const body of ['{}', '{"code":10000,"data":"x"}', '{invalid']) {
        const subject = adapterWithPlan({
            '/open/tokenInfo': [tokenSuccess('T')], '/open/getUserName': [{ body }], '/open/trainingExamPaper': [ok('ticket')]
        });
        await assert.rejects(subject.adapter.commonReturnStudentBaseInfo(studentParameters()));
    }
});

test('ready JAVA student skips account sync and only requests a fresh entry ticket', async () => {
    const parameters = { ...studentParameters(), accountWasReady: true };
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('T')], '/open/trainingExamPaper': [ok('ticket')]
    });
    await subject.adapter.commonReturnStudentBaseInfo(parameters);
    assert.deepEqual(subject.calls.map(call => call.path), ['/open/tokenInfo', '/open/trainingExamPaper']);
    assert.ok(subject.calls.every(call => call.url.startsWith('https://local.invalid/open/')));
});
