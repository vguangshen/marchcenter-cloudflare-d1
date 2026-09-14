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

async function rawGet(pathname, init = {}) {
  return harness.miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, { method: 'GET', ...init });
}

async function upload(bytes, title, accentJson = null) {
  // Node 的 FormData 在部分运行时下生成的 Content-Type 与 Worker 的
  // formData() 解析不兼容，这里手工构造 multipart/form-data。
  const boundary = `----MarchCenterVersionE2E${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="image"; filename="test.png"\r\n'
    + 'Content-Type: image/png\r\n\r\n'
  );
  const accentPart = accentJson ? encoder.encode(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="accent"\r\n\r\n${accentJson}`
  ) : null;
  const mid = encoder.encode(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n--${boundary}--\r\n`
  );
  const chunks = [head, bytes];
  if (accentPart) chunks.push(accentPart);
  chunks.push(mid);
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return harness.miniflare.dispatchFetch('http://marchcenter.local/api/wallpapers/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${harness.token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
}

async function uploadVersioned(bytes, title, accentJson = null) {
  const response = await upload(bytes, title, accentJson);
  assert.equal(response.status, 201);
  return (await response.json()).wallpaper;
}

async function replaceContent(id, bytes) {
  const boundary = `----MarchCenterReplaceE2E${Math.random().toString(36).slice(2)}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="optimized.png"\r\n`
    + 'Content-Type: image/png\r\n\r\n'
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return harness.miniflare.dispatchFetch(`http://marchcenter.local/api/wallpapers/${id}/replace`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${harness.token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
}

test('wallpaper versioning: 新上传生成新版本，且版本即内容哈希', async () => {
  const wallpaperA = await uploadVersioned(uniquePng(21), 'Version A');
  assert.match(wallpaperA.content_hash, /^[0-9a-f]{64}$/, '上传响应必须携带内容哈希');

  const wallpaperB = await uploadVersioned(uniquePng(22), 'Version B');
  assert.notEqual(wallpaperB.id, wallpaperA.id);
  assert.notEqual(wallpaperB.content_hash, wallpaperA.content_hash, '不同内容必须产生不同版本');

  // 相同内容去重：重复上传返回同一条记录（版本稳定，不产生新 URL）。
  const duplicated = await upload(uniquePng(21), 'Version A again');
  const wallpaperDup = (await duplicated.json()).wallpaper;
  assert.equal(wallpaperDup.id, wallpaperA.id);
  assert.equal(wallpaperDup.content_hash, wallpaperA.content_hash);

  const list = await harness.api('/api/wallpapers');
  assert.equal(list.status, 200);
  for (const item of list.data.wallpapers) {
    assert.match(item.content_hash, /^[0-9a-f]{64}$/, '壁纸列表必须携带内容哈希');
  }
});

test('wallpaper versioning: 不同版本使用不同 Cache API 键，新版本不命中旧版本缓存', async () => {
  const wallpaperA = await uploadVersioned(uniquePng(31), 'Isolation A');
  const wallpaperB = await uploadVersioned(uniquePng(32), 'Isolation B');

  const urlA = `/api/wallpapers/${wallpaperA.id}/content?v=${wallpaperA.content_hash}`;
  const urlB = `/api/wallpapers/${wallpaperB.id}/content?v=${wallpaperB.content_hash}`;

  const firstA = await rawGet(urlA);
  assert.equal(firstA.status, 200);
  assert.equal(firstA.headers.get('x-marchcenter-cache'), 'MISS', '首次请求必须为缓存未命中（回源 R2）');

  const secondA = await rawGet(urlA);
  assert.equal(secondA.status, 200);
  assert.equal(secondA.headers.get('x-marchcenter-cache'), 'HIT', '同一版本第二次请求必须命中边缘缓存');
  assert.deepEqual(Buffer.from(await secondA.arrayBuffer()), uniquePng(31), '命中内容必须正确');

  const firstB = await rawGet(urlB);
  assert.equal(firstB.status, 200);
  assert.equal(firstB.headers.get('x-marchcenter-cache'), 'MISS', '新版本 URL 必须重新回源，不得命中旧版本缓存条目');

  const staleVersion = await rawGet(`/api/wallpapers/${wallpaperA.id}/content?v=stale-version`, { redirect: 'manual' });
  assert.equal(staleVersion.status, 307, '错误版本必须重定向到规范 URL，不得生成缓存条目');
  assert.equal(
    staleVersion.headers.get('location'),
    `http://marchcenter.local/api/wallpapers/${wallpaperA.id}/content?v=${wallpaperA.content_hash}`,
    '重定向目标必须是带正确内容哈希的规范 URL'
  );

  const unversioned = await rawGet(`/api/wallpapers/${wallpaperA.id}/content`, { redirect: 'manual' });
  assert.equal(unversioned.status, 307, '无版本参数的 URL 必须重定向到规范 URL');

  // 正确版本 + 附加参数也必须 307：CDN 默认缓存键含完整查询串，
  // 任何非唯一 v 的查询串都会制造 CDN 碎片。
  const variant = await rawGet(`${urlA}&x=1`, { redirect: 'manual' });
  assert.equal(variant.status, 307, '正确版本 + 附加参数必须重定向到严格规范 URL');
  assert.equal(variant.headers.get('cache-control'), 'no-store', '307 必须显式 no-store，防止被缓存规则命中');
  assert.equal(
    variant.headers.get('location'),
    `http://marchcenter.local/api/wallpapers/${wallpaperA.id}/content?v=${wallpaperA.content_hash}`,
    '变体 URL 的重定向目标必须是严格规范 URL'
  );

  // 重复 v 参数同样 307。
  const duplicate = await rawGet(`${urlA}&v=${wallpaperA.content_hash}`, { redirect: 'manual' });
  assert.equal(duplicate.status, 307, '重复 v 参数必须重定向到严格规范 URL');

  // 规范 URL 本身在变体请求后仍正常命中（未受污染）。
  const canonicalAgain = await rawGet(urlA);
  assert.equal(canonicalAgain.status, 200);
  assert.equal(canonicalAgain.headers.get('x-marchcenter-cache'), 'HIT', '规范 URL 缓存条目必须保持不变');

  const secondB = await rawGet(urlB);
  assert.equal(secondB.headers.get('x-marchcenter-cache'), 'HIT', '新版本自身的第二次请求正常命中');
});

test('wallpaper versioning: 删除后旧版本 URL 不再可用（当前节点缓存已尽力失效）', async () => {
  const wallpaper = await uploadVersioned(uniquePng(41), 'Delete me');

  const url = `/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`;
  const first = await rawGet(url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-marchcenter-cache'), 'MISS', '首个请求回源 R2 并写入边缘缓存');
  const warmed = await rawGet(url);
  assert.equal(warmed.headers.get('x-marchcenter-cache'), 'HIT', '删除前先让版本化 URL 进入边缘缓存');

  const deleted = await harness.api(`/api/wallpapers/${wallpaper.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);

  const afterDelete = await rawGet(url);
  assert.equal(afterDelete.status, 404, '删除后旧版本 URL 必须立即 404');

  const unversionedUrl = `/api/wallpapers/${wallpaper.id}/content`;
  const unversioned = await rawGet(unversionedUrl);
  assert.equal(unversioned.status, 404, '无版本参数的 URL 也应一并失效');
});

test('wallpaper replace: 内容替换生成新版本，旧 URL 失效，主题色保留，同内容 no-op', async () => {
  const wallpaper = await uploadVersioned(uniquePng(81), 'Replace me');
  const oldUrl = `/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`;
  assert.equal((await rawGet(oldUrl)).status, 200, '替换前旧版本 URL 正常');
  assert.equal((await rawGet(oldUrl)).headers.get('x-marchcenter-cache'), 'HIT', '先让旧版本进入边缘缓存');

  const newBytes = uniquePng(82);
  const response = await replaceContent(wallpaper.id, newBytes);
  assert.equal(response.status, 200, '内容替换必须成功');
  const updated = (await response.json()).wallpaper;
  assert.equal(updated.id, wallpaper.id, '替换必须保留壁纸行（id 不变）');
  assert.notEqual(updated.content_hash, wallpaper.content_hash, '内容变化必须生成新版本');
  assert.equal(updated.source_type, wallpaper.source_type, '来源类型必须保留');

  const newUrl = `/api/wallpapers/${updated.id}/content?v=${updated.content_hash}`;
  const newResponse = await rawGet(newUrl);
  assert.equal(newResponse.status, 200, '新版本 URL 必须可读');
  assert.equal(newResponse.headers.get('x-marchcenter-cache'), 'MISS', '新版本首次请求必须回源');
  assert.deepEqual(Buffer.from(await newResponse.arrayBuffer()), newBytes, '新内容必须与替换字节一致');

  // 旧版本 URL：行还在但哈希已替换 → 307 重定向到新规范 URL
  // （且旧版本缓存条目已尽力失效，不会继续返回旧 200）。
  const oldVersionResponse = await rawGet(oldUrl, { redirect: 'manual' });
  assert.equal(oldVersionResponse.status, 307, '旧版本 URL 必须重定向到新版本规范 URL');
  assert.equal(
    oldVersionResponse.headers.get('location'),
    `http://marchcenter.local/api/wallpapers/${updated.id}/content?v=${updated.content_hash}`,
    '旧版本重定向目标必须是新版本规范 URL'
  );
  assert.equal(oldVersionResponse.headers.get('cache-control'), 'no-store', '旧版本 307 必须 no-store');

  // 相同内容：no-op，不产生新版本。
  const noopResponse = await replaceContent(wallpaper.id, newBytes);
  assert.equal(noopResponse.status, 200);
  const noopWallpaper = (await noopResponse.json()).wallpaper;
  assert.equal(noopWallpaper.content_hash, updated.content_hash, '相同内容不得产生新版本');
});

test('wallpaper self-heal: D1 行存在但 R2 对象丢失时，同内容替换会原位恢复', async () => {
  const bytes = uniquePng(87);
  const wallpaper = await uploadVersioned(bytes, 'Repair missing R2');
  const [row] = await harness.rows('SELECT object_key FROM wallpaper_library WHERE id = ?', wallpaper.id);
  const bucket = await harness.miniflare.getR2Bucket('WALLPAPERS');
  await bucket.delete(row.object_key);

  const missing = await rawGet(`/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`);
  assert.equal(missing.status, 404);

  const repaired = await replaceContent(wallpaper.id, bytes);
  assert.equal(repaired.status, 200);
  const restored = await rawGet(`/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), bytes);
});

test('wallpaper accent: 上传携带主题色落库，site config 随所选壁纸下发', async () => {
  const withAccent = await uploadVersioned(uniquePng(91), 'Accent Wallpaper', '{"rgb":"59 130 246","themeKey":"blue"}');
  assert.ok(withAccent.theme_accent, '上传响应必须携带主题色');
  const storedAccent = JSON.parse(withAccent.theme_accent);
  assert.deepEqual(storedAccent, { rgb: '59 130 246', themeKey: 'blue' }, '主题色必须原样落库');

  // 非法 accent：静默忽略（不阻塞上传，且不留脏数据）。
  const badAccent = await uploadVersioned(uniquePng(92), 'Bad Accent', '{"rgb":"999 0 0","themeKey":"blue"}');
  assert.equal(badAccent.theme_accent, null, '非法 accent 必须拒绝');

  const withoutAccent = await uploadVersioned(uniquePng(93), 'No Accent');
  assert.equal(withoutAccent.theme_accent, null, '未提交 accent 时不返回主题色');

  // site config：选中带 accent 的壁纸后下发 themeAccent。
  await harness.api('/api/config/site', {
    body: {
      globalTheme: {
        effectMode: 'wallpaper',
        backgroundMode: 'wallpaper',
        wallpaperId: withAccent.id
      }
    }
  });
  let payload = await (await rawGet('/api/config/site')).json();
  assert.deepEqual(payload.globalTheme.themeAccent, { rgb: '59 130 246', themeKey: 'blue' },
    'site config 必须携带落库的主题色（登录页图片加载前即应用）');

  // 未选中壁纸：不返回主题色。
  await harness.api('/api/config/site', {
    body: {
      globalTheme: { effectMode: 'default', wallpaperId: null }
    }
  });
  payload = await (await rawGet('/api/config/site')).json();
  assert.equal(payload.globalTheme.themeAccent, undefined, '未选中壁纸时不返回主题色');

  // 无 accent 的壁纸：themeAccent 为 null，前端回退为图片加载后提取。
  await harness.api('/api/config/site', {
    body: {
      globalTheme: {
        effectMode: 'wallpaper',
        backgroundMode: 'wallpaper',
        wallpaperId: withoutAccent.id
      }
    }
  });
  payload = await (await rawGet('/api/config/site')).json();
  assert.equal(payload.globalTheme.themeAccent, null);
});

test('site config 返回 wallpaperVersion，且随所选壁纸变化', async () => {
  const wallpaperA = await uploadVersioned(uniquePng(51), 'Config A');
  const wallpaperB = await uploadVersioned(uniquePng(52), 'Config B');

  const saved = await harness.api('/api/config/site', {
    body: {
      welcomeTitle: '版本验证',
      globalTheme: {
        effectMode: 'wallpaper',
        backgroundMode: 'wallpaper',
        wallpaperId: wallpaperA.id
      }
    }
  });
  assert.equal(saved.status, 200);

  const first = await rawGet('/api/config/site');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  let payload = await first.json();
  assert.equal(payload.globalTheme.wallpaperId, wallpaperA.id);
  assert.equal(payload.globalTheme.wallpaperVersion, wallpaperA.content_hash, 'site config 必须返回壁纸版本');

  const refreshedRead = await rawGet('/api/config/site');
  assert.equal(refreshedRead.headers.get('cache-control'), 'no-store', '公开配置每次都必须从 D1 读取');

  await harness.api('/api/config/site', {
    body: {
      welcomeTitle: '版本验证',
      globalTheme: {
        effectMode: 'wallpaper',
        backgroundMode: 'wallpaper',
        wallpaperId: wallpaperB.id
      }
    }
  });
  payload = await (await rawGet('/api/config/site')).json();
  assert.equal(payload.globalTheme.wallpaperVersion, wallpaperB.content_hash, '切换壁纸后版本必须同步变化');

  await harness.api('/api/config/site', {
    body: {
      welcomeTitle: '版本验证',
      globalTheme: { effectMode: 'default', wallpaperId: null }
    }
  });
  payload = await (await rawGet('/api/config/site')).json();
  assert.equal(payload.globalTheme.wallpaperVersion, undefined, '未选中壁纸时不返回版本');

  // 不存在的壁纸 id：不返回版本（避免向前端暴露无效 URL）。
  await harness.api('/api/config/site', {
    body: {
      globalTheme: { effectMode: 'wallpaper', backgroundMode: 'wallpaper', wallpaperId: 987654 }
    }
  });
  payload = await (await rawGet('/api/config/site')).json();
  assert.equal(payload.globalTheme.wallpaperVersion, undefined);
});

test('静态资源：SPA 导航回退到 index.html，缺失的 hash 资源返回真实 404', async () => {
  const navigation = await rawGet('/dashboard', { headers: { Accept: 'text/html' } });
  assert.equal(navigation.status, 200);
  const navigationText = await navigation.text();
  assert.match(navigationText, /<div id="root">/, '深层导航必须回退到 SPA 的 index.html');

  const root = await rawGet('/');
  assert.equal(root.status, 200);

  const missingAsset = await rawGet('/assets/index-00000000000000000000.js', {
    headers: { Accept: '*/*' }
  });
  assert.equal(missingAsset.status, 404, '缺失的 hash 资源必须返回真实 404，不能返回 index.html');
  const assetText = await missingAsset.text();
  assert.doesNotMatch(assetText, /<div id="root">/, '404 响应不得包含 HTML 文档');
});
