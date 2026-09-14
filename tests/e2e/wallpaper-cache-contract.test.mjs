import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// --- Worker 侧：Cache API 写入必须后台执行，不能阻塞图片响应 ---
const workerSource = await readFile(resolve(projectRoot, 'worker/index.js'), 'utf8');
assert.match(
  workerSource,
  /ctx\.waitUntil\(\s*caches\.default\.put\(cacheKey, cacheResponse\)\.catch\(\(\)\s*=>\s*\{\}\)\s*\);/,
  '缓存填充必须通过 ctx.waitUntil 在后台执行'
);
assert.doesNotMatch(
  workerSource,
  /await\s+caches\.default\.put/,
  '不得使用 await 阻塞 caches.default.put'
);
assert.match(workerSource, /if \(cachedResponse\)\s*\{[\s\S]*?return cachedResponse;/, '保留 Cache API 命中路径');
assert.match(workerSource, /const cacheKey = new Request\(canonical\);/, '只有严格规范 URL（唯一 v=正确哈希）允许进入 Cache API 缓存键');
assert.match(workerSource, /url\.searchParams\.size !== 1/, '只接受唯一 v 参数的严格规范查询串');
assert.match(workerSource, /'Cache-Control': 'no-store'/, '非规范请求的 307 必须显式 no-store');
assert.match(workerSource, /X-MarchCenter-Cache/, '壁纸响应必须提供调试缓存头');

// --- 读取路径必须保持流式：R2 body 直接 tee，禁止完整缓冲 ---
const serveWallpaperSource = workerSource.slice(workerSource.indexOf('async function serveWallpaper'));
assert.match(
  serveWallpaperSource,
  /object\.body\.tee\(\)/,
  'R2 body 必须通过 tee() 分流：一路立即流向客户端'
);
assert.match(
  serveWallpaperSource,
  /const \[clientBody, cacheBody\] = object\.body\.tee\(\)/,
  'MISS 路径必须显式 tee 为客户端流与缓存流'
);
assert.match(
  serveWallpaperSource,
  /const clientResponse = new Response\(clientBody/,
  '客户端必须立即拿到流式响应'
);
assert.doesNotMatch(
  serveWallpaperSource,
  /\.arrayBuffer\(\)|\.text\(\)|\.json\(\)/,
  '壁纸读取路径不得对 R2 对象调用 arrayBuffer/text 等完整缓冲方法'
);
assert.match(
  serveWallpaperSource,
  /ctx\.waitUntil\(\s*caches\.default\.put\(cacheKey, cacheResponse\)/,
  '缓存写入流必须由 ctx.waitUntil 后台执行'
);

// --- 前端：同一壁纸只允许一次主要加载（单个 <img> 同时用于显示与主题色）---
const appSource = await readFile(resolve(projectRoot, 'src/App.jsx'), 'utf8');
const wallpaperSource = await readFile(resolve(projectRoot, 'src/hooks/useWallpaperPresentation.js'), 'utf8');
assert.equal(
  (wallpaperSource.match(/new Image\(\)/g) || []).length,
  0,
  'App 不得再为壁纸创建独立 Image：显示与主题色必须共用同一个 <img> 元素'
);
assert.match(wallpaperSource, /extractImageThemeFromElement\(image\)/, '主题色应从已加载的同一 <img> 元素提取');
assert.match(
  wallpaperSource,
  /isSiteConfigReady[\s\S]*?effectMode === 'wallpaper'/,
  '壁纸必须等待服务端配置确认，避免先显示旧缓存壁纸'
);
assert.match(appSource, /setIsSiteConfigReady\(true\)/, '配置请求成功后必须解除壁纸门控');
assert.match(
  wallpaperSource,
  /handleError[\s\S]*?setLoadFailed\(true\)[\s\S]*?localStorage\.removeItem\(key\)/,
  '壁纸加载失败必须快速回退并清除本地主题色缓存'
);
assert.match(
  wallpaperSource,
  /scheduleAccentExtraction[\s\S]*?extractImageThemeFromElement\(image\)/,
  '主题色从已加载的同一 <img> 元素提取，一次下载一次解码'
);

// --- imageTheme：必须提供复用已加载图片的入口 ---
const themeSource = await readFile(resolve(projectRoot, 'src/utils/imageTheme.js'), 'utf8');
assert.match(themeSource, /export const extractImageThemeFromElement = \(image\)\s*=>\s*\{/);

// --- 服务端：Bing URL 尺寸必须用 URL API 覆盖而非字符串追加 ---
const serviceSource = await readFile(resolve(projectRoot, 'server/services/wallpaperService.js'), 'utf8');
assert.match(
  serviceSource,
  /url\.searchParams\.set\('w', '1920'\)/,
  'Bing 尺寸参数必须通过 URL API 覆盖'
);
assert.doesNotMatch(
  serviceSource,
  /`\$\{value\}\$\{separator\}w=1920`/,
  '不得使用字符串拼接追加尺寸参数'
);
assert.doesNotMatch(
  serviceSource,
  /wallpaper\s*=\s*await attachAccentFromJpeg/,
  '主题色补算结果不得覆盖壁纸记录对象'
);
assert.match(serviceSource, /if \(!object\)[\s\S]*?downloadLatestBingImage/, 'R2 文件缺失时必须重新下载自愈');
assert.match(serviceSource, /await env\.DB\.batch\(statements\)/, '删除当前壁纸时配置与数据库记录必须原子提交');
assert.match(serviceSource, /recordBingSyncStatus/, 'Bing 同步必须记录成功或失败状态');

// --- 站点公开配置：跨节点一致性优先，不进入 Cache API ---
const siteConfigSource = await readFile(resolve(projectRoot, 'server/routes/siteConfig.js'), 'utf8');
assert.match(siteConfigSource, /PUBLIC_CACHE_CONTROL = 'no-store'/);
assert.doesNotMatch(siteConfigSource, /caches\.default\.(?:match|put)/, '公开配置不得使用节点本地 Cache API');

console.log('Wallpaper cache contract tests passed');
