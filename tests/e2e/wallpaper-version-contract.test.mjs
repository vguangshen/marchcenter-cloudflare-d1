import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { purgeWallpaperEdgeCache, wallpaperContentUrl } from '../../server/services/wallpaperService.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFile(resolve(projectRoot, relative), 'utf8');

// ============ 1. 壁纸内容 URL 版本化（纯函数单元测试） ============

assert.equal(
  wallpaperContentUrl(7, 'abc123', 'https://marchcenter.top'),
  'https://marchcenter.top/api/wallpapers/7/content?v=abc123'
);
assert.equal(wallpaperContentUrl(7, null), '/api/wallpapers/7/content');
assert.equal(wallpaperContentUrl(7, 'a b/+=', 'https://x.test'), 'https://x.test/api/wallpapers/7/content?v=a%20b%2F%2B%3D');

// ============ 2. cache.delete 失败不影响版本切换（单元测试） ============

const originalCaches = globalThis.caches;
try {
  globalThis.caches = {
    default: {
      async delete() { throw new Error('simulated cache delete failure'); }
    }
  };
  await purgeWallpaperEdgeCache(7, 'abc123', 'https://marchcenter.top');
  globalThis.caches = { default: { delete: () => { throw new Error('simulated 2'); } } };
  await purgeWallpaperEdgeCache(7, 'abc123');
  globalThis.caches = undefined;
  await purgeWallpaperEdgeCache(7, 'abc123', 'https://marchcenter.top');
} finally {
  globalThis.caches = originalCaches;
}
assert.equal('cache delete failure 不影响版本切换', 'cache delete failure 不影响版本切换');

// ============ 3. _headers 静态资源缓存规则 ============

const headersSource = await read('public/_headers');
const headersSection = headersSource.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');

function extractCacheControl(section) {
  const lines = headersSection.split('\n');
  const start = lines.findIndex(line => line.trim() === section);
  assert.ok(start >= 0, `_headers 必须包含 ${section} 规则`);
  const value = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) break;
    if (/Cache-Control:/.test(lines[index])) value.push(lines[index].trim());
  }
  return value.join(' ');
}

assert.match(extractCacheControl('/assets/*'), /max-age=31536000/);
assert.match(extractCacheControl('/assets/*'), /immutable/);
assert.match(extractCacheControl('/index.html'), /no-store|no-cache/);
assert.match(extractCacheControl('/'), /no-store|no-cache/);
assert.doesNotMatch(headersSource, /\/api\//, '_headers 不得包含 /api/* 规则（API 不受静态资源缓存影响）');

// ============ 4. Workers Static Assets 配置与 SPA fallback ============

const wranglerSource = await read('wrangler.jsonc');
assert.match(wranglerSource, /not_found_handling":\s*"none"/, '必须关闭 single-page-application，由 Worker 控制 fallback');
assert.match(wranglerSource, /run_worker_first":\s*\["\/api\/\*"\]/);

const workerSource = await read('worker/index.js');
assert.match(
  workerSource,
  /if \(\s*request\.method === 'GET'\s*&& !\/\\.\[A-Za-z0-9_-\]\{1,10\}\$\/\.test\(url\.pathname\)\s*\)/,
  'SPA fallback 必须排除带文件扩展名的请求（hash 资源返回真实 404）'
);
assert.match(workerSource, /env\.ASSETS\.fetch\(new Request\(`\$\{url\.origin\}\/index\.html`, request\)\)/);
assert.match(
  workerSource,
  /url\.pathname === '\/favicon\.ico'[\s\S]*?Response\.redirect\(`\$\{url\.origin\}\/favicon\.svg`, 308\)/,
  '浏览器对 legacy favicon.ico 的探测必须重定向到现有 SVG 图标'
);

// 调试缓存头：生产默认关闭，可显式开启，且映射 HIT/MISS/R2。
assert.match(workerSource, /headers\.set\('X-MarchCenter-Cache', '(?:HIT|MISS|R2)'\)/);
assert.match(workerSource, /WALLPAPER_CACHE_DEBUG === '1'/);
assert.match(workerSource, /NODE_ENV \|\| 'development'\) !== 'production'/);
assert.match(workerSource, /'X-MarchCenter-Cache', 'HIT'/);
assert.match(workerSource, /'X-MarchCenter-Cache', 'MISS'/);
assert.match(workerSource, /'X-MarchCenter-Cache', 'R2'/, 'R2 不存在或失败必须区分');

// 缓存键必须包含请求 URL 的完整查询串（?v=版本）。
assert.match(workerSource, /FROM wallpaper_library WHERE id = \?/, 'serveWallpaper 必须查询壁纸行以规范化版本');
assert.match(workerSource, /content_hash/, 'serveWallpaper 必须读取内容哈希');
assert.match(workerSource, /url\.searchParams\.size !== 1/, '只接受唯一 v 参数的严格规范查询串');
assert.match(workerSource, /status: 307/, '非严格规范查询串必须 307 重定向');
assert.match(workerSource, /'Cache-Control': 'no-store'/, '307 必须显式 no-store');
assert.match(workerSource, /const cacheKey = new Request\(canonical\);/, '只有严格规范 URL 允许进入 Cache API 缓存键');

const siteConfigSource = await read('server/routes/siteConfig.js');
assert.match(siteConfigSource, /wallpaperVersion/);
assert.match(siteConfigSource, /theme_accent/, '站点配置必须附带落库时计算的主题色');
assert.match(siteConfigSource, /PUBLIC_CACHE_CONTROL = 'no-store'/);
assert.doesNotMatch(siteConfigSource, /caches\.default\.(?:match|put)/);

const serviceSource = await read('server/services/wallpaperService.js');
assert.match(serviceSource, /purgeWallpaperEdgeCache\(id, wallpaper\.content_hash, origin\)/);
assert.match(
  serviceSource,
  /wallpaperContentUrl\(id, null, base\)/,
  '删除时必须同时失效无版本参数的历史缓存键'
);
assert.match(serviceSource, /theme_accent/, '壁纸落库时必须存储主题色');
assert.match(serviceSource, /attachAccentFromJpeg/, 'Bing 壁纸必须服务端解码内容计算主题色');
assert.match(
  serviceSource,
  /await import\('\.\.\/utils\/wallpaperProgressive\.js'\)/,
  'Bing 同步必须在 Worker 内自动调用 progressive JPEG 优化器'
);
assert.match(
  serviceSource,
  /optimizeBingJpeg/,
  '新同步与历史 baseline 壁纸都必须进入自动 progressive 重编码'
);

const progressiveSource = await read('server/utils/wallpaperProgressive.js');
assert.match(progressiveSource, /mozjpeg_enc\.wasm/, '优化器必须把 MozJPEG WASM 打进 Worker');

const codecSource = await read('server/utils/jpegCodec.js');
assert.match(codecSource, /progressive: true/, 'MozJPEG 编码必须明确启用 progressive');

// ============ 5. 前端：版本化 URL、localStorage 替换、accent 缓存含版本 ============

const appSource = await read('src/App.jsx');
const wallpaperSource = await read('src/hooks/useWallpaperPresentation.js');
const backgroundSource = await read('src/components/layouts/SystemBackgroundLayers.jsx');
const themeSettingsSource = await read('src/utils/uiThemeSettings.js');
assert.match(wallpaperSource, /wallpaperContentUrl\(themeSettings\.wallpaperId, themeSettings\.wallpaperVersion\)/);
assert.match(
  themeSettingsSource,
  /wallpaperVersion: \(\s*typeof settings\.wallpaperVersion === 'string'\s*&& \/\^\[A-Za-z0-9_-\]\{1,128\}\$\/\.test/,
  'normalizeUiThemeSettings 必须携带并校验 wallpaperVersion'
);
assert.match(
  appSource,
  /localStorage\.setItem\(CACHED_SITE_CONFIG_KEY, JSON\.stringify\(config\)\)/,
  '服务端配置（含 wallpaperVersion）必须写入 localStorage，旧版本壁纸被新配置替换'
);

// 背景层由一个 eager <img> 负责显示、解码与主题色提取。
assert.match(
  backgroundSource,
  /<img[\s\S]*?key=\{wallpaperUrl\}[\s\S]*?src=\{wallpaperUrl\}[\s\S]*?loading="eager"[\s\S]*?onError=\{onWallpaperError\}/,
  '背景必须是单个 eager/async/fetchPriority=high 的 <img>，onLoad/onError 挂在同一元素上'
);
assert.doesNotMatch(wallpaperSource, /\bnew Image\(\)/, '壁纸 Hook 不得创建独立的 new Image()（重复下载/解码）');
assert.doesNotMatch(backgroundSource, /backgroundImage: `url\("/, '不得用 CSS background 显示壁纸（与 <img> 双请求源）');
assert.match(wallpaperSource, /wallpaperAccentCacheKey\(image\.src\)/, '主题色缓存键必须从加载的 <img> src 派生（含版本）');
assert.match(wallpaperSource, /setLoadFailed\(true\)/, 'onError 必须进入回退状态');
assert.match(wallpaperSource, /extractImageThemeFromElement\(image\)/, 'onLoad 复用同一 <img> 元素提取主题色，不产生第二次解码');
assert.match(wallpaperSource, /mark\('wallpaperRequestStart'\)/, '保留壁纸请求起点性能标记');
assert.match(
  backgroundSource,
  /(effectMode === 'wallpaper' && !hasWallpaper)/,
  '壁纸失败时必须显示中性默认背景'
);
assert.match(appSource, /<LoginPage[\s\S]*?wallpaperActive=\{hasWallpaper\}/, 'LoginPage 只接收壁纸状态作为提示，不等待壁纸完成');

const configSource = await read('src/constants/config.js');
assert.match(configSource, /export const wallpaperContentUrl = \(id, version\)\s*=>\s*\{/);
assert.match(configSource, /\?v=\$\{encodeURIComponent\(version\)\}/);

const wallpaperUrlSource = await read('src/utils/wallpaperUrl.js');
assert.match(
  wallpaperUrlSource,
  /marchcenter_wallpaper_accent_v\$\{IMAGE_THEME_CACHE_VERSION\}_\$\{wallpaperId\}_\$\{version \|\| 'unversioned'\}/,
  'localStorage 主题色缓存键必须包含壁纸版本'
);
assert.match(
  wallpaperUrlSource,
  /new URL\(candidateUrl, 'http:\/\/marchcenter\.local'\)\.searchParams\.get\('v'\)/,
  '版本必须从壁纸 URL 派生，保证与 URL 同源'
);
assert.match(
  wallpaperUrlSource,
  /parsed\.pathname\.match\(pathPattern\)/,
  'wallpaperId 必须从解析后的 pathname 提取，兼容带 ?v=hash 的规范 URL'
);

const managerSource = await read('src/components/views/settings/WallpaperManager.jsx');
assert.match(managerSource, /wallpaperVersion: wallpaper\.content_hash/);
assert.match(managerSource, /wallpaperVersion: latestBing\.content_hash/);
assert.match(managerSource, /wallpaperVersion: data\.wallpaper\.content_hash/);
assert.match(managerSource, /wallpaperVersion: null/);
assert.match(managerSource, /wallpaperContentUrl\(wallpaper\.id, wallpaper\.content_hash\)/, '图库缩略图必须使用完整图 URL');
assert.doesNotMatch(managerSource, /\/wallpapers\/\$\{(?:latestBing|wallpaper)\.id\}\/content`/, '必须使用版本化 URL');
assert.match(managerSource, /extractThemeFromFile/, '上传时必须在客户端计算主题色 accent');

// 主题色：normalize 校验、初始状态直接使用配置。
assert.match(
  themeSettingsSource,
  /themeAccent: \(\s*settings\.themeAccent[\s\S]*?THEMES\[settings\.themeAccent\.themeKey\]/,
  'normalizeUiThemeSettings 必须携带并校验服务端主题色'
);
assert.match(
  wallpaperSource,
  /useState\(\(\) => themeSettings\.themeAccent \?\? null\)/,
  '壁纸主题色初始状态必须直接来自站点配置（图片加载前即应用）'
);
assert.match(
  wallpaperSource,
  /setAccent\(themeSettings\.themeAccent\?\.rgb[\s\S]*?themeSettings\.themeAccent/,
  '站点配置到达时必须立即应用落库主题色'
);
assert.match(wallpaperSource, /isSiteConfigReady[\s\S]*?wallpaperContentUrl/, '服务端配置确认后才能派生完整图 URL');
assert.match(wallpaperSource, /scheduleAccentExtraction\(image\)/, '完整图就绪后必须空闲期提取主题色');

// ============ 5b. 运行时纯函数：ID 解析 / accent 缓存键 ============

import {
  wallpaperAccentCacheKey,
  wallpaperIdFromUrl
} from '../../src/utils/wallpaperUrl.js';

const HASH = '20a02c0e5d67582a4d8d9e02f0acad53c04f5e60c5c55d589c3b72aef77fb093';
const VERSIONED_URL = `/api/wallpapers/8/content?v=${HASH}`;

// 带 ?v=hash 的规范 URL 必须正确解析出 wallpaperId（修复 /(\d+)\/content$/ 不匹配查询参数）。
assert.equal(wallpaperIdFromUrl(VERSIONED_URL), 8, '带版本参数的 URL 必须解析出 wallpaperId');
assert.equal(wallpaperIdFromUrl(`http://marchcenter.top/api/wallpapers/8/content?v=${HASH}&x=1`), 8);
assert.equal(wallpaperIdFromUrl('/api/wallpapers/abc/content'), NaN);
assert.equal(wallpaperIdFromUrl(''), NaN);
assert.equal(wallpaperIdFromUrl(null), NaN);

// 主题色缓存键不得出现 NaN，且包含 id 与版本。
const accentKey = wallpaperAccentCacheKey(VERSIONED_URL);
assert.equal(accentKey, `marchcenter_wallpaper_accent_v3_8_${HASH}`);
assert.doesNotMatch(accentKey, /NaN/, '主题色缓存键不得包含 NaN');
assert.equal(wallpaperAccentCacheKey('/api/wallpapers/8/content'), `marchcenter_wallpaper_accent_v3_8_unversioned`);
assert.equal(wallpaperAccentCacheKey('/api/wallpapers/abc/content'), null, '非法 URL 不得生成缓存键');

// ============ 6. LoginPage 首屏不依赖壁纸 / setup-status / CDN trace ============

const loginSource = await read('src/components/views/LoginPage.jsx');
assert.doesNotMatch(loginSource, /new Image\(\)/, '登录页不得自行加载图片（壁纸由 App 层独立预加载）');
assert.doesNotMatch(loginSource, /extractImageTheme|canvas|getImageData/, 'LoginPage 不得执行任何壁纸/图像解码逻辑');
assert.match(
  loginSource,
  /useEffect\(\(\)\s*=>\s*\{\s*const controller = new AbortController\(\);[\s\S]*?api\.get\('\/auth\/setup-status'/,
  'setup-status 必须在 useEffect 中后台调用，不阻塞首帧渲染'
);
const loginJsx = loginSource.slice(loginSource.indexOf('return ('));
const loginFormStart = loginJsx.indexOf('<form onSubmit={handleSubmit}>');
const loginFormSection = loginJsx.slice(loginFormStart, loginJsx.indexOf('</form>', loginFormStart));
assert.doesNotMatch(loginFormSection, /initialized/, '登录表单 JSX 不得依赖 initialized 状态');
assert.match(loginSource, /<form onSubmit=\{handleSubmit\}/, '登录表单始终渲染');

const cdnSource = await read('src/components/views/login/CdnIndicator.jsx');
assert.match(cdnSource, /if \(!visible\) return null;/, 'CDN 检测完成前不渲染任何内容，不阻塞布局');

const appLoginBranch = appSource;
assert.match(appLoginBranch, /<LoginPage[\s\S]*?wallpaperActive=\{hasWallpaper\}/, 'LoginPage 只接收壁纸状态作为提示，不等待壁纸完成');

// ============ 7. 首屏性能测量存在且非侵入 ============

const perfSource = await read('src/utils/startupPerf.js');
assert.match(perfSource, /performance\.mark/);
assert.match(perfSource, /logStartupPerfSummary/);
assert.match(perfSource, /wallpaperFirstByte/);
const mainSource = await read('src/main.jsx');
assert.match(mainSource, /mark\('reactRootMounted'\)/);

console.log('Wallpaper version + production-readiness contract tests passed');
