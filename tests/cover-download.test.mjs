import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_COVER_BYTES, readLimitedCover, waitForCoverOperation } from '../server/utils/coverDownload.js';

test('declared oversized covers cancel without reading the body', async () => {
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream({ pull() { pulls += 1; }, cancel() { canceled = true; } }, { highWaterMark: 0 });
    const result = await readLimitedCover(new Response(body, { headers: { 'Content-Length': String(MAX_COVER_BYTES + 1) } }), new AbortController().signal);
    assert.equal(result, null);
    assert.equal(pulls, 0);
    assert.equal(canceled, true);
});

test('chunked covers stop and cancel on the first chunk crossing five MiB', async () => {
    let chunks = 0;
    let canceled = false;
    const body = new ReadableStream({
        pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { canceled = true; }
    }, { highWaterMark: 0 });
    assert.equal(await readLimitedCover(new Response(body), new AbortController().signal), null);
    assert.equal(chunks, 6);
    assert.equal(canceled, true);
});

test('a cover exactly at the byte limit remains valid', async () => {
    const bytes = new Uint8Array(MAX_COVER_BYTES);
    bytes[0] = 137;
    bytes[MAX_COVER_BYTES - 1] = 10;
    const result = new Uint8Array(await readLimitedCover(new Response(bytes), new AbortController().signal));
    assert.equal(result.byteLength, MAX_COVER_BYTES);
    assert.equal(result[0], 137);
    assert.equal(result[MAX_COVER_BYTES - 1], 10);
});

test('aborting a pending body read promptly cancels the underlying stream', async () => {
    let canceled = false;
    const controller = new AbortController();
    const body = new ReadableStream({ pull() {}, cancel() { canceled = true; } }, { highWaterMark: 0 });
    const reading = readLimitedCover(new Response(body), controller.signal);
    const reason = new DOMException('fixture timeout', 'TimeoutError');
    controller.abort(reason);
    await assert.rejects(reading, error => error === reason);
    assert.equal(canceled, true);
});

test('an already canceled request cancels its response without starting reads', async () => {
    let canceled = false;
    const controller = new AbortController();
    controller.abort(new DOMException('fixture canceled', 'AbortError'));
    const body = new ReadableStream({ cancel() { canceled = true; } }, { highWaterMark: 0 });
    await assert.rejects(readLimitedCover(new Response(body), controller.signal), { name: 'AbortError' });
    assert.equal(canceled, true);
});

test('the batch deadline releases a pending storage operation and prevents new canceled operations', async () => {
    const controller = new AbortController();
    let complete;
    const pending = waitForCoverOperation(() => new Promise(resolve => { complete = resolve; }), controller.signal);
    controller.abort(new DOMException('fixture timeout', 'TimeoutError'));
    await assert.rejects(pending, { name: 'TimeoutError' });
    complete('late storage response');
    let invoked = false;
    await assert.rejects(waitForCoverOperation(() => { invoked = true; }, controller.signal), { name: 'TimeoutError' });
    assert.equal(invoked, false);
});

test('normal storage results and errors keep their original contract', async () => {
    const signal = new AbortController().signal;
    assert.equal(await waitForCoverOperation(() => Promise.resolve('stored'), signal), 'stored');
    const error = new Error('fixture storage unavailable');
    await assert.rejects(waitForCoverOperation(() => Promise.reject(error), signal), failure => failure === error);
});
