import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const previous = { window: globalThis.window, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
globalThis.window = {
    location: { hostname: 'localhost', origin: 'http://localhost' },
    setTimeout, clearTimeout, dispatchEvent() {}
};
globalThis.localStorage = { getItem: () => null };
const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../../src/utils/api.js', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent'
});
const { api, apiFetch } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
afterEach(() => { globalThis.fetch = previous.fetch; });
after(() => { globalThis.window = previous.window; globalThis.localStorage = previous.localStorage; });

function stallBody(contentType = 'application/json', firstChunk = '') {
    const observed = { cancelled: false };
    globalThis.fetch = async (_url, options) => {
        observed.signal = options.signal;
        return new Response(new ReadableStream({
            start(controller) {
                if (firstChunk) controller.enqueue(new TextEncoder().encode(firstChunk));
            },
            cancel() { observed.cancelled = true; }
        }), { headers: { 'Content-Type': contentType } });
    };
    return observed;
}

test('JSON body remains bounded after headers have arrived', { timeout: 2000 }, async () => {
    const observed = stallBody();
    await assert.rejects(api.get('/slow-json', { timeoutMs: 25, retry: 0 }), { code: 'request_timeout' });
    assert.equal(observed.signal.aborted, true);
    assert.equal(observed.cancelled, true);
});

test('blob body remains bounded after headers have arrived', { timeout: 2000 }, async () => {
    const observed = stallBody('image/png');
    await assert.rejects(api.blob('/slow-image', { timeoutMs: 25, retry: 0 }), { code: 'request_timeout' });
    assert.equal(observed.cancelled, true);
});

test('caller can cancel an in-progress body after receiving headers', { timeout: 2000 }, async () => {
    const observed = stallBody();
    const controller = new AbortController();
    const response = await apiFetch('/cancel-body', { signal: controller.signal, timeoutMs: 1000, retry: 0 });
    const reading = response.json();
    controller.abort();
    await assert.rejects(reading, { name: 'AbortError' });
    assert.equal(observed.cancelled, true);
});

test('raw Response consumers retain deadline protection and can explicitly cancel', { timeout: 2000 }, async () => {
    const observed = stallBody('text/plain');
    const response = await apiFetch('/trace', { timeoutMs: 25, retry: 0 });
    await response.body.cancel();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(observed.cancelled, true);
    assert.equal(observed.signal.aborted, false);
});

test('complete JSON and 204 responses finish cleanly without a later abort', { timeout: 2000 }, async () => {
    const signals = [];
    globalThis.fetch = async (_url, options) => {
        signals.push(options.signal);
        return _url.endsWith('/empty') ? new Response(null, { status: 204 }) : Response.json({ ok: true });
    };
    assert.deepEqual(await api.get('/ready', { timeoutMs: 25 }), { ok: true });
    assert.equal(await api.delete('/empty', { timeoutMs: 25 }), null);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(signals.some(signal => signal.aborted), false);
});

test('invalid success JSON is rejected while upstream error messages remain compatible', async () => {
    globalThis.fetch = async () => new Response('not JSON', { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(api.get('/invalid', { retry: 0 }), { code: 'invalid_response' });
    globalThis.fetch = async () => Response.json({ error: 'upstream failed', code: 'upstream_failure' }, { status: 503 });
    await assert.rejects(api.get('/failure', { retry: 0 }), { message: 'upstream failed', status: 503, code: 'upstream_failure' });
});

test('stream timeout and caller cancellation remain active while reading events', { timeout: 2000 }, async () => {
    let observed = stallBody('text/event-stream', 'event: progress\ndata: {"phase":"loading"}\n\n');
    const events = [];
    await assert.rejects(api.stream('/stream', { timeoutMs: 25 }, event => events.push(event)), { code: 'request_timeout' });
    assert.equal(events.length, 1);
    assert.equal(observed.cancelled, true);
    observed = stallBody('text/event-stream', 'event: progress\ndata: {}\n\n');
    const controller = new AbortController();
    await assert.rejects(api.stream('/stream', { timeoutMs: 1000, signal: controller.signal }, () => controller.abort()), { name: 'AbortError' });
    assert.equal(observed.cancelled, true);
});

test('a successful final stream result and failing event callbacks release the reader', { timeout: 2000 }, async () => {
    globalThis.fetch = async () => new Response('event: result\ndata: {"data":{"ok":true}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    assert.deepEqual(await api.stream('/stream', { timeoutMs: 1000 }), { ok: true });
    const observed = stallBody('text/event-stream', 'event: progress\ndata: {}\n\n');
    await assert.rejects(api.stream('/stream', {}, () => { throw new Error('callback failed'); }), /callback failed/);
    assert.equal(observed.cancelled, true);
});

test('stream HTTP errors read their message before cleanup and retain the deadline', { timeout: 2000 }, async () => {
    globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) {
            setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('{"error":"provider unavailable"}'));
                controller.close();
            }, 10);
        }
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(api.stream('/stream', { timeoutMs: 1000 }), { message: 'provider unavailable', status: 503 });
    const observed = stallBody();
    const fetchBody = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        const response = await fetchBody(...args);
        return new Response(response.body, { status: 503 });
    };
    await assert.rejects(api.stream('/stream', { timeoutMs: 25 }), { code: 'request_timeout' });
    assert.equal(observed.cancelled, true);
});
