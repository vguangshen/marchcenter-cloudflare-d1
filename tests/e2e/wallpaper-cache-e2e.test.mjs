import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let harness;

// 1x1 PNG，仅用于验证存储/传输链路，内容合法即可。
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

before(async () => {
  harness = await createProductionHarness();
});
after(async () => { await harness?.dispose(); });

function uniquePng(salt) {
  const bytes = Buffer.from(PNG_1PX);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] + (salt % 256)) & 0xff;
  return bytes;
}

async function rawGet(pathname) {
  return harness.miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, {
    method: 'GET'
  });
}

async function upload(bytes, title) {
  // Node 的 FormData 在部分运行时下生成的 Content-Type 与 Worker 的
  // formData() 解析不兼容，这里手工构造 multipart/form-data。
  const boundary = `----MarchCenterE2E${Math.random().toString(36).slice(2)}`;
  const head = new TextEncoder().encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="image"; filename="test.png"\r\n'
    + 'Content-Type: image/png\r\n\r\n'
  );
  const mid = new TextEncoder().encode(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}--\r\n`
  );
  const body = new Uint8Array(head.length + bytes.length + mid.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(mid, head.length + bytes.length);
  return harness.miniflare.dispatchFetch('http://marchcenter.local/api/wallpapers/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${harness.token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
}

test('wallpaper content: upload, read, cache hit, then 404 after delete (edge cache purged)', async () => {
  const bytes = uniquePng(1);
  const uploaded = await upload(bytes, 'Cache e2e wallpaper');
  assert.equal(uploaded.status, 201);
  const wallpaper = (await uploaded.json()).wallpaper;
  assert.ok(wallpaper.id > 0);
  assert.equal(wallpaper.byte_size, PNG_1PX.length);

  const url = `/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`;
  const first = await rawGet(url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('content-type'), 'image/png');
  const cacheControl = first.headers.get('cache-control') || '';
  assert.match(cacheControl, /immutable/);
  assert.match(cacheControl, /max-age=31536000/);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), bytes);

  const second = await rawGet(url);
  assert.equal(second.status, 200);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes);

  const deleted = await harness.api(`/api/wallpapers/${wallpaper.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);

  const afterDelete = await rawGet(url);
  assert.equal(afterDelete.status, 404, '旧边缘缓存必须在删除后同步失效');
});

test('unknown wallpaper id returns 404 JSON and never a cached response', async () => {
  const response = await rawGet('/api/wallpapers/999999/content');
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.match(payload.error, /壁纸不存在/);
});

test('public site config is always read consistently with no-store', async () => {
  const first = await rawGet('/api/config/site');
  assert.equal(first.status, 200);
  const cacheControl = first.headers.get('cache-control') || '';
  assert.equal(cacheControl, 'no-store');

  const saved = await harness.api('/api/config/site', {
    body: { welcomeTitle: '缓存失效验证', globalTheme: { effectMode: 'default' } }
  });
  assert.equal(saved.status, 200);

  const refreshed = await rawGet('/api/config/site');
  assert.equal(refreshed.status, 200);
  const payload = await refreshed.json();
  assert.equal(payload.welcomeTitle, '缓存失效验证');
  assert.equal(payload.globalTheme?.effectMode, 'default');
});

test('site config save response is private/no-store and never cached', async () => {
  const saved = await harness.api('/api/config/site', {
    body: { welcomeTitle: 'no-store 验证' }
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.response.headers.get('cache-control'), 'no-store');
});

test('site config rejects unknown, malformed and oversized structures without turning them into 500 errors', async () => {
  const valid = await harness.api('/api/config/site', {
    body: {
      loginTitle: { text: 'MarchCenter', align: 'center', fontSize: '2xl' },
      footerVisibility: 'all',
      globalTheme: {
        effectMode: 'default',
        lightDark: 'auto',
        backgroundMode: 'default',
        systemEffects: { loginEntrance: true, dashboardCardReveal: false }
      }
    }
  });
  assert.equal(valid.status, 200, valid.text);

  const unknown = await harness.api('/api/config/site', {
    body: { welcomeTitle: '你好', unexpectedServerFlag: true }
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.data.message, /未知字段/);

  const malformedRichText = await harness.api('/api/config/site', {
    body: { loginTitle: { text: '标题', onClick: 'alert(1)' } }
  });
  assert.equal(malformedRichText.status, 400);
  assert.match(malformedRichText.data.message, /未知字段/);

  const malformedEffect = await harness.api('/api/config/site', {
    body: { globalTheme: { systemEffects: { loginEntrance: 'yes' } } }
  });
  assert.equal(malformedEffect.status, 400);
  assert.match(malformedEffect.data.message, /布尔值/);

  const largeFields = [
    'loginVisualTitle', 'loginVisualSubtitle', 'loginWelcomeTitle', 'loginWelcomeSubtitle',
    'loginPasswordTabText', 'loginCodeTabText', 'loginUsernameLabel', 'loginUsernamePlaceholder',
    'loginCodeAccountLabel', 'loginCodeAccountPlaceholder', 'loginPasswordLabel',
    'loginPasswordPlaceholder', 'loginCodeLabel', 'loginCodeSendText', 'loginCodeHint',
    'loginCodeDisabledHint', 'loginSubmitText'
  ];
  const oversized = await harness.api('/api/config/site', {
    body: Object.fromEntries(largeFields.map(key => [key, 'x'.repeat(4000)]))
  });
  assert.equal(oversized.status, 413);
  assert.match(oversized.data.message, /64KB/);
});

test('malformed percent-encoded route parameters return 400 instead of throwing a router 500', async () => {
  const response = await harness.miniflare.dispatchFetch(
    'http://marchcenter.local/api/wallpapers/%E0%A4%A',
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${harness.token}` }
    }
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /路径参数编码无效/);
});

test('chunked wallpaper uploads are capped while streaming even without Content-Length', async () => {
  const chunk = new Uint8Array(256 * 1024);
  const chunkCount = Math.ceil((13 * 1024 * 1024 + 1) / chunk.byteLength);
  const body = new ReadableStream({
    start(controller) {
      for (let index = 0; index < chunkCount; index += 1) controller.enqueue(chunk);
      controller.close();
    }
  });
  const response = await harness.miniflare.dispatchFetch(
    'http://marchcenter.local/api/wallpapers/upload',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'multipart/form-data; boundary=MarchCenterOversize'
      },
      body,
      duplex: 'half'
    }
  );
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /12MB/);
});

test('wallpaper 404 / missing wallpaper does not block public site config or login payloads', async () => {
  const missing = await rawGet('/api/wallpapers/424242/content');
  assert.equal(missing.status, 404);

  const health = await rawGet('/api/health');
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.ok, true);

  const config = await rawGet('/api/config/site');
  assert.equal(config.status, 200);
});
