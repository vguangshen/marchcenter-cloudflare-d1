import assert from 'node:assert/strict';
import test from 'node:test';
import express from '../../server/compat/express.js';

function streamedRequest(body, contentType = 'application/json') {
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream({
        start(controller) {
            const chunkSize = 64 * 1024;
            for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
                controller.enqueue(bytes.slice(offset, offset + chunkSize));
            }
            controller.close();
        }
    });
    return new Request('https://marchcenter.test/echo', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: stream,
        duplex: 'half'
    });
}

test('chunked JSON is rejected when actual bytes exceed the configured limit', async () => {
    const app = express();
    app.post('/echo', (req, res) => res.json(req.body));
    const request = streamedRequest(JSON.stringify({ value: 'x'.repeat(2048) }));

    const response = await app.handle(request, { bodyLimitBytes: 1024 });

    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /请求内容不能超过/);
});

test('bounded JSON remains available to route handlers', async () => {
    const app = express();
    app.post('/echo', (req, res) => res.json(req.body));
    const request = streamedRequest(JSON.stringify({ value: '正常请求' }));

    const response = await app.handle(request, { bodyLimitBytes: 1024 });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: '正常请求' });
});
