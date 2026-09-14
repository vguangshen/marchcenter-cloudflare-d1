import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from '../server/compat/express.js';
import worker from '../worker/index.js';
import { createLastSeenWriteTracker } from '../server/utils/lastSeenWriteTracker.js';
import {
    deriveImageTheme,
    IMAGE_THEME_CACHE_VERSION,
    nearestThemeKey
} from '../src/utils/imageTheme.js';

const tracker = createLastSeenWriteTracker({
    writeIntervalMs: 100,
    entryTtlMs: 300,
    pruneIntervalMs: 0,
    maxEntries: 3
});
assert.equal(tracker.shouldWrite(1, 1_000), true);
assert.equal(tracker.shouldWrite(1, 1_050), false);
assert.equal(tracker.shouldWrite(1, 1_101), true);
tracker.shouldWrite(2, 1_102);
tracker.shouldWrite(3, 1_103);
tracker.shouldWrite(4, 1_104);
assert.equal(tracker.size(), 3, 'last-seen tracker must remain bounded');
tracker.shouldWrite(5, 1_500);
assert.equal(tracker.size(), 1, 'expired last-seen entries must be pruned');

const app = express();
app.get('/internal-error', (_req, res) => {
    res.status(500).json({ error: 'SQLITE_ERROR: secret_table does not exist' });
});
app.get('/service-error', (_req, res) => {
    res.status(503).json({ error: '外部执行端暂时不可用' });
});
const internalResponse = await app.handle(new Request('https://marchcenter.top/internal-error'));
const internalBody = await internalResponse.json();
assert.equal(internalResponse.status, 500);
assert.equal(internalBody.error, '服务器内部错误');
assert.equal(internalBody.code, 'internal_error');
assert.match(internalBody.requestId, /^[0-9a-f-]{36}$/i);
assert.equal(JSON.stringify(internalBody).includes('secret_table'), false);
const serviceResponse = await app.handle(new Request('https://marchcenter.top/service-error'));
assert.deepEqual(await serviceResponse.json(), { error: '外部执行端暂时不可用' });

const assetResponse = await worker.fetch(
    new Request('https://marchcenter.top/'),
    {
        NODE_ENV: 'production',
        ASSETS: { fetch: async () => new Response('<!doctype html>') }
    },
    { waitUntil() {} }
);
const csp = assetResponse.headers.get('content-security-policy') || '';
assert.match(csp, /default-src 'self'/);
assert.match(csp, /object-src 'none'/);
assert.match(csp, /script-src 'self'/);


assert.equal(nearestThemeKey([239, 68, 68]), 'red');
assert.equal(nearestThemeKey([34, 197, 94]), 'green');
assert.equal(nearestThemeKey([99, 102, 241]), 'indigo');
assert.equal(nearestThemeKey([0, 69, 64]), 'teal');
assert.equal(IMAGE_THEME_CACHE_VERSION, 3);

const createPixelField = (colors) => new Uint8ClampedArray(
    colors.flatMap(({ rgb, count }) => Array.from(
        { length: count },
        () => [...rgb, 255]
    ).flat())
);

const highestSaturationTheme = deriveImageTheme(createPixelField([
    { rgb: [105, 165, 215], count: 700 },
    { rgb: [0, 64, 64], count: 120 },
    { rgb: [245, 245, 245], count: 180 }
]));
assert.equal(highestSaturationTheme.rgb, '0 64 64');

const neutralTheme = deriveImageTheme(createPixelField([
    { rgb: [172, 176, 182], count: 900 },
    { rgb: [130, 130, 130], count: 20 }
]));
assert.equal(neutralTheme.themeKey, 'slate');
assert.ok(
    ['172 176 182', '130 130 130'].includes(neutralTheme.rgb),
    '灰阶主题也必须返回图片中实际存在的颜色'
);

const sourceRoot = path.resolve('src');
const sourceFiles = [];
const walk = async (directory) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(target);
        else if (/\.(?:js|jsx)$/.test(entry.name)) sourceFiles.push(target);
    }
};
await walk(sourceRoot);
const blockingCalls = [];
const unmanagedFetches = [];
for (const file of sourceFiles) {
    const source = await fs.readFile(file, 'utf8');
    if (/\b(?:window\.)?(?:alert|confirm)\s*\(/.test(source)) blockingCalls.push(file);
    if (
        /\bfetch\s*\(/.test(source)
        && !file.endsWith(path.join('utils', 'api.js'))
        && !file.endsWith(path.join('views', 'login', 'CdnIndicator.jsx'))
        && !source.includes('apiFetch as fetch')
        && !source.includes('const fetch = apiFetch')
    ) unmanagedFetches.push(file);
}
assert.deepEqual(blockingCalls, [], 'native alert/confirm calls must not return');
assert.deepEqual(unmanagedFetches, [], 'API calls must use the shared request transport');

const appSource = await fs.readFile(path.join(sourceRoot, 'App.jsx'), 'utf8');
const stylesSource = await fs.readFile(path.join(sourceRoot, 'index.css'), 'utf8');
const sharedConfigSource = await fs.readFile(path.join(sourceRoot, 'constants', 'config.js'), 'utf8');
const settingsDarkStylesSource = await fs.readFile(path.join(sourceRoot, 'styles', 'settings-dark.css'), 'utf8');
const wallpaperUrlSource = await fs.readFile(path.join(sourceRoot, 'utils', 'wallpaperUrl.js'), 'utf8');
const motionPreferencesSource = await fs.readFile(path.join(sourceRoot, 'utils', 'motionPreferences.js'), 'utf8');
const themeSettingsSource = await fs.readFile(path.join(sourceRoot, 'utils', 'uiThemeSettings.js'), 'utf8');
const themeControllerSource = await fs.readFile(path.join(sourceRoot, 'hooks', 'useThemeController.js'), 'utf8');
const wallpaperPresentationSource = await fs.readFile(path.join(sourceRoot, 'hooks', 'useWallpaperPresentation.js'), 'utf8');
const backgroundLayersSource = await fs.readFile(path.join(sourceRoot, 'components', 'layouts', 'SystemBackgroundLayers.jsx'), 'utf8');
const authSessionSource = await fs.readFile(path.join(sourceRoot, 'hooks', 'useAuthSession.js'), 'utf8');
const loginPageSource = await fs.readFile(path.join(sourceRoot, 'components', 'views', 'LoginPage.jsx'), 'utf8');
const navbarSource = await fs.readFile(path.join(sourceRoot, 'components', 'layouts', 'Navbar.jsx'), 'utf8');
assert.match(
    wallpaperPresentationSource,
    /\[['"]bing['"], ['"]wallpaper['"]\]\.includes\(themeSettings\.backgroundMode\)[\s\S]*?extractImageThemeFromElement\(image\)/,
    '每日 Bing 与图库壁纸都必须进入主题色提取流程'
);
assert.match(
    wallpaperUrlSource,
    /marchcenter_wallpaper_accent_v\$\{IMAGE_THEME_CACHE_VERSION\}_\$\{wallpaperId\}_\$\{version \|\| 'unversioned'\}/,
    '壁纸主题色缓存不应只绑定 Bing 模式'
);
assert.match(
    backgroundLayersSource,
    /data-wallpaper-state=\{isWallpaperSoftened \? 'softened' : 'ambient'\}/,
    '主页壁纸状态应标记为环境背景'
);
assert.match(
    wallpaperPresentationSource,
    /isSiteConfigReady[\s\S]*?wallpaperContentUrl[\s\S]*?hasWallpaper: Boolean\(candidateUrl\) && !loadFailed/,
    '壁纸必须等待站点配置确认，并在有效版本 URL 可用时显示'
);
assert.match(
    wallpaperPresentationSource,
    /setLoadFailed\(true\)/,
    '壁纸 404 / 加载失败时必须立即回退默认背景，不得长期停留在加载状态'
);
assert.match(
    wallpaperPresentationSource,
    /localStorage\.removeItem\(key\)/,
    '壁纸加载失败时必须清除本地主题色缓存，避免下次刷新复用错误数据'
);
assert.match(
    themeSettingsSource,
    /\{\s*\.\.\.globalThemeSettings,\s*lightDark:\s*localTheme\.lightDark\s*\}/,
    '本地偏好只能覆盖日夜模式，不能把历史壁纸重新带回首帧'
);
assert.match(
    themeControllerSource,
    /useState\(readStoredUiThemeSettings\)/,
    '主题控制器首帧必须使用统一的已存储明暗偏好解析'
);
assert.match(
    themeControllerSource,
    /localStorage\.removeItem\(LOCAL_THEME_PREFERENCE_KEY\)/,
    '超级管理员保存全局明暗模式后必须清除当前设备的旧手动覆盖'
);
assert.match(
    themeControllerSource,
    /storeLocalLightDark\(newMode\)/,
    '登录页日月切换只能保存明暗偏好，不能复制整套全局外观配置'
);
assert.match(
    settingsDarkStylesSource,
    /\.dark \.settings-theme-aware[\s\S]*?color-scheme:\s*dark/,
    '旧设置面板必须提供统一的夜间表面与原生表单配色适配'
);
assert.doesNotMatch(authSessionSource, /startViewTransition|userAgent|-moz-appearance/, '登录导航动画必须采用统一 CSS 路径，不得包含浏览器特判或原生快照分支');
assert.match(authSessionSource, /prefersReducedMotion\(\)/, '登录导航动画必须使用统一的减少动态效果判断');
assert.match(motionPreferencesSource, /prefers-reduced-motion: reduce/, '统一动态效果判断必须尊重系统偏好');
assert.match(loginPageSource, /login-portal-header-unlocking/, '登录状态栏必须提供收拢到悬浮栏的退场状态');
assert.match(loginPageSource, /config\.loginTextAlign \|\| 'left'/, '登录欢迎标题与说明默认必须保持左对齐');
assert.match(loginPageSource, /dark:focus:bg-slate-800/, '登录输入框聚焦时必须保持夜间背景');
assert.match(sharedConfigSource, /theme-form-control[\s\S]*?dark:focus:bg-slate-900/, '公共输入框聚焦时必须保持夜间背景');
assert.match(stylesSource, /\.dark \.account-api-input:-webkit-autofill[\s\S]*?-webkit-text-fill-color:\s*#f8fafc/, '浏览器自动填充不得恢复白底白字');
assert.match(stylesSource, /\.dark\s*\{\s*color-scheme:\s*dark;/, '夜间模式必须同步原生日期与下拉控件配色');
assert.match(navbarSource, /dashboard-navbar-entering/, '首页状态栏必须提供与登录栏衔接的入场状态');
assert.match(stylesSource, /\.login-portal-header-unlocking[\s\S]*?--login-navbar-dock-side/, '登录状态栏必须收拢到首页悬浮栏几何位置');
assert.match(navbarSource, /THEMES\[activeThemeColor\][\s\S]*?navbarTheme\.gradient/, '首页 Logo 必须与登录页共用系统主题渐变');
assert.match(appSource, /<Navbar[\s\S]*?activeThemeColor=\{activeThemeColor\}/, '首页必须把当前系统主题色传入顶部栏');
assert.doesNotMatch(stylesSource, /view-transition-name:\s*marchcenter-navbar|@keyframes dashboard-navbar-arrive/, '顶部栏不得使用浏览器快照或直接移动玻璃模糊层');
assert.doesNotMatch(stylesSource, /@keyframes dashboard-navbar-control-in\s*\{[^}]*transform:/, '首页控件入场不得改变坐标，避免动画层退出时产生像素跳动');
assert.doesNotMatch(authSessionSource, /navbarTransitionTimerRef/, '顶部栏入场结束不得通过定时状态更新触发整栏重渲染');
assert.match(loginPageSource, /onTransitionEnd[\s\S]*?propertyName === 'transform'[\s\S]*?onUnlockTransitionEnd/, '登录栏必须由真实 transform 过渡结束事件提交页面切换');
assert.match(authSessionSource, /pendingLoginRef[\s\S]*?completeLoginTransition/, '登录成功数据必须等待顶部栏真实过渡完成后提交');
assert.doesNotMatch(authSessionSource, /shouldAnimate \? 860/, '不得使用估算的 CSS 动画时长切换登录与首页');
assert.match(navbarSource, /siteConfig\?\.loginBrandName[\s\S]*?tracking-tight/, '登录页与首页必须共用品牌文字来源和字距');
assert.match(loginPageSource, /login-portal-header[\s\S]*?max-w-7xl items-center justify-between px-4 py-3["']/, '登录栏内部必须与首页悬浮栏保持相同的 16px 水平内边距');
assert.doesNotMatch(loginPageSource, /max-w-7xl items-center justify-between px-4 py-3 sm:px-8/, '登录栏桌面端不得额外增加 16px 内边距导致品牌切换后左跳');

console.log('Platform hardening tests passed.');
