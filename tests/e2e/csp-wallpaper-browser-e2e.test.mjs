// 真实浏览器 CSP E2E：加载 vite build 产物，通过 node http 服务器下发
// 与生产完全相同的两组 Content-Security-Policy（worker/index.js 的 CSP +
// public/_headers 的 CSP，浏览器会叠加强制执行两者的交集）。
//
// 覆盖验收：
//   1. 入口无经典内联脚本，控制台无 CSP 违规；
//   2. localStorage 旧配置不会在服务端确认前设置 preload；
//   3. React 收到公开配置后只请求一次规范壁纸 URL；
//   4. 日夜主题下登录按钮渐变覆盖透明边框，且不重复平铺；
//   6. 非法 ID / 版本 / 外部 URL 仍被拒绝。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { testBrowserOptions } from '../helpers/browser.mjs';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const distDir = path.join(projectRoot, 'dist');
let ORIGIN = 'http://127.0.0.1';
const WALLPAPER_ID = 8;
const WALLPAPER_VERSION = 'v1testhash';
let EXPECTED_URL;
const VALID_GLOBAL_THEME = {
    effectMode: 'wallpaper',
    backgroundMode: 'wallpaper',
    wallpaperId: WALLPAPER_ID,
    wallpaperVersion: WALLPAPER_VERSION
};
const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

function runBuild() {
    if (process.env.MARCHCENTER_TEST_BUILD_READY === '1') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const child = spawn('npm', ['run', 'build'], { cwd: projectRoot, shell: true, stdio: 'ignore' });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))));
        child.on('error', reject);
    });
}

async function extractWorkerCsp() {
    const source = await fs.readFile(path.join(projectRoot, 'worker', 'index.js'), 'utf8');
    const arrayText = source.match(/\[\s*"default-src 'self'"[\s\S]*?"manifest-src 'self'"\s*\]/);
    assert.ok(arrayText, 'worker/index.js 必须包含 CSP 数组');
    const directives = [...arrayText[0].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    return directives.join('; ');
}

async function extractPagesCsp() {
    const source = await fs.readFile(path.join(projectRoot, 'public', '_headers'), 'utf8');
    const line = source.match(/Content-Security-Policy:\s*([^\n]+)/);
    assert.ok(line, 'public/_headers 必须包含 Content-Security-Policy');
    // _headers is a text file and Git may check it out with CRLF on Windows.
    // Line terminators are not part of a header value: passing the trailing
    // CR to Node's HTTP server throws before a response can reach Chromium.
    return line[1].trim();
}

const scriptSrcOf = (csp) => {
    const directive = csp.match(/script-src[^;]*/);
    assert.ok(directive, 'CSP 必须包含 script-src');
    return directive[0];
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff2': 'font/woff2'
};

function createTestServer(workerCsp, pagesCsp) {
    const htmlHeaders = {
        'Content-Security-Policy': [workerCsp, pagesCsp],
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
    };
    return http.createServer(async (req, res) => {
        const requestUrl = new URL(req.url, ORIGIN);
        const pathname = decodeURIComponent(requestUrl.pathname);
        // 主 bundle 响应人为延迟：确保壁纸预加载请求（低优先级）在
        // 主 bundle 完成响应之前已被调度，时序断言因此确定性成立。
        if (pathname.startsWith('/assets/') && pathname.endsWith('.js')) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (pathname.startsWith('/api/')) {
            if (pathname === '/api/config/site') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ globalTheme: VALID_GLOBAL_THEME }));
                return;
            }
            if (pathname === '/api/wallpapers/8/content') {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'ETag': '"v1testhash"'
                });
                res.end(TINY_PNG);
                return;
            }
            if (pathname === '/api/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, runtime: 'csp-browser-e2e', database: 'd1' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
            return;
        }
        let filePath = path.join(distDir, pathname === '/' ? 'index.html' : pathname);
        let content;
        try {
            content = await fs.readFile(filePath);
        } catch {
            if (!pathname.startsWith('/assets/')) {
                filePath = path.join(distDir, 'index.html');
                content = await fs.readFile(filePath);
            } else {
                res.writeHead(404);
                res.end('not found');
                return;
            }
        }
        const headers = {
            'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream'
        };
        if (pathname === '/' || pathname === '/index.html') {
            Object.assign(headers, htmlHeaders);
        } else if (pathname.startsWith('/assets/')) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        }
        res.writeHead(200, headers);
        res.end(content);
    });
}

function collectPageErrors(page) {
    const cspViolations = [];
    const otherConsole = [];
    page.on('console', (message) => {
        const text = message.text();
        if (/Content Security Policy|Refused to execute|script-src|violates/i.test(text)) {
            cspViolations.push(text);
        } else if (message.type() === 'error') {
            otherConsole.push(text);
        }
    });
    page.on('pageerror', (error) => otherConsole.push(String(error)));
    return { cspViolations, otherConsole };
}

async function seedSiteConfig(context, globalTheme) {
    await context.addInitScript((theme) => {
        window.localStorage.setItem(
            'competition_hub_site_config',
            JSON.stringify({ globalTheme: theme })
        );
    }, globalTheme);
}

let server;
let baseUrl;
let browser;
let workerCsp;
let pagesCsp;

before(async () => {
    await runBuild();
    workerCsp = await extractWorkerCsp();
    pagesCsp = await extractPagesCsp();
    server = createTestServer(workerCsp, pagesCsp);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    ORIGIN = `http://127.0.0.1:${server.address().port}`;
    baseUrl = ORIGIN;
    EXPECTED_URL = `${ORIGIN}/api/wallpapers/${WALLPAPER_ID}/content?v=${WALLPAPER_VERSION}`;
    browser = await chromium.launch(testBrowserOptions());
});

after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
});

test('CSP 两个来源保持一致', () => {
    assert.doesNotThrow(() => http.validateHeaderValue('Content-Security-Policy', workerCsp),
        'Worker CSP 必须是合法的 HTTP 响应头值');
    assert.doesNotThrow(() => http.validateHeaderValue('Content-Security-Policy', pagesCsp),
        '_headers CSP 不能把文本文件行结束符带入 HTTP 响应头值');
    const workerScriptSrc = scriptSrcOf(workerCsp);
    const pagesScriptSrc = scriptSrcOf(pagesCsp);
    assert.equal(workerScriptSrc, pagesScriptSrc, '两个 CSP 来源的 script-src 必须完全一致');
    assert.doesNotMatch(workerScriptSrc, /unsafe-inline/, 'script-src 禁止使用 unsafe-inline');
});

test('a cold default scene renders only the confirmed day or night artwork', async () => {
    const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
    const { promise: waitForConfig, resolve: confirmConfig } = Promise.withResolvers();
    try {
        const page = await context.newPage();
        const requests = [];
        page.on('request', request => {
            const pathname = new URL(request.url()).pathname;
            if (pathname.startsWith('/default-scene/')) requests.push(pathname);
        });
        await page.route('**/api/config/site', async route => {
            await waitForConfig;
            await route.fulfill({ json: { globalTheme: { effectMode: 'default', lightDark: 'dark' } } });
        });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('.login-auth-card').waitFor();
        assert.equal(await page.locator('.default-scene').count(), 0, 'no artwork before the day/night choice is known');

        confirmConfig();
        const night = page.locator('.default-scene[data-scene-mode="night"]');
        await night.waitFor();
        const layers = night.locator('.layered-scene-layer');
        await layers.first().waitFor();
        assert.equal(await layers.count(), 8, 'sky, far, mid, focal, front, track, front, details');
        await night.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
        assert.equal(await page.locator('.default-scene[data-scene-mode="dawn"]').count(), 0);
        assert.equal(await night.locator('.layered-scene').getAttribute('data-scene-phase'), 'static', 'reduced motion shows the finished scene');
        assert.deepEqual(requests, [], 'the layered scene ships with the app and needs no image request');
    } finally {
        confirmConfig();
        await context.close();
    }
});

const SCENE_CASES = [
    { name: 'default skyline', theme: { effectMode: 'default', lightDark: 'light' }, scene: 'competition',
        roles: ['sky', 'far', 'mid', 'focal', 'front', 'track', 'front', 'details'] },
    { name: 'mid-autumn holiday scene', theme: { effectMode: 'immersive', immersive: 'mid_autumn', lightDark: 'dark' }, scene: 'immersive:mid_autumn',
        roles: ['sky', 'celestial', 'far', 'mid', 'focal', 'front', 'details'] },
    { name: 'theme-colour track', theme: { effectMode: 'color', manualColor: 'blue', lightDark: 'light' }, scene: 'accent',
        roles: ['sky', 'far', 'mid', 'front', 'focal', 'details'] }
];

for (const sceneCase of SCENE_CASES) {
    test(`the ${sceneCase.name} assembles its layers once with compositor-only motion`, async () => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
        try {
            const page = await context.newPage();
            const { cspViolations } = collectPageErrors(page);
            await page.route('**/api/config/site', route => route.fulfill({ json: { globalTheme: sceneCase.theme } }));
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            const scene = page.locator(`.layered-scene[data-scene="${sceneCase.scene}"]`);
            await page.locator(`.layered-scene--playing[data-scene="${sceneCase.scene}"]`).waitFor();
            const animations = await scene.evaluate(root => [...root.querySelectorAll('.layered-scene-layer')].map(layer => ({
                role: layer.getAttribute('class').match(/layered-scene-layer--(\w+)/)[1],
                names: layer.getAnimations().map(animation => animation.animationName),
                props: layer.getAnimations().flatMap(animation => animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)))
                    .filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))
            })));
            assert.deepEqual(animations.map(entry => entry.role), sceneCase.roles);
            for (const entry of animations) {
                assert.equal(entry.names.length, 1, `${entry.role} animates`);
                assert.deepEqual([...new Set(entry.props)].sort(), entry.role === 'track' ? ['transform'] : ['opacity', 'transform'], `${entry.role} only animates transform/opacity`);
            }
            if (sceneCase.roles.includes('track')) {
                // Mid-wipe the window has moved up from below while the artwork inside stays exactly in place.
                const wipe = await scene.evaluate(root => {
                    const window = root.querySelector('.layered-scene-layer--track');
                    const image = window.querySelector('.layered-scene-track-image');
                    const animations = [...window.getAnimations(), ...image.getAnimations()];
                    animations.forEach(animation => { animation.pause(); animation.currentTime = 1200; });
                    const result = {
                        windowTop: window.getBoundingClientRect().top,
                        imageTop: image.getBoundingClientRect().top,
                        imageAnimation: image.getAnimations().map(animation => animation.animationName)
                    };
                    animations.forEach(animation => animation.play());
                    return result;
                });
                assert.deepEqual(wipe.imageAnimation, ['layered-scene-track-image']);
                assert.ok(wipe.windowTop > 50, `window is part-way up (${wipe.windowTop}px)`);
                assert.ok(Math.abs(wipe.imageTop) < 1, `artwork stays in place (${wipe.imageTop}px)`);
            }
            await page.locator(`.layered-scene--static[data-scene="${sceneCase.scene}"]`).waitFor({ timeout: 5000 });
            assert.equal(await scene.evaluate(root => root.querySelector('.layered-scene-layer').getAnimations().length), 0, 'hints are dropped after the intro');
            assert.deepEqual(cspViolations, []);
        } finally {
            await context.close();
        }
    });
}

test('登录按钮日夜主题均以完整边框区域绘制渐变且不平铺', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
    try {
        const page = await context.newPage();
        const { cspViolations, otherConsole } = collectPageErrors(page);
        await page.route('**/api/config/site', route => route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ globalTheme: { effectMode: 'color', manualColor: 'orange', lightDark: 'light', systemEffects: { loginEntrance: false } } })
        }));
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        const button = page.locator('.login-auth-submit');
        await button.waitFor({ state: 'visible' });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('competition_hub_site_config') || '{}').globalTheme?.manualColor === 'orange');
        await page.locator('#login-username').fill('visual-regression-user');
        await page.locator('#login-password').fill('fixture-password');
        const screenshotDir = path.join(projectRoot, '_build', 'verification');
        await fs.mkdir(screenshotDir, { recursive: true });
        for (const theme of ['light', 'dark']) {
            if (theme === 'dark') await page.getByTitle('切换到夜间模式', { exact: true }).click();
            await page.waitForFunction(dark => Boolean(document.querySelector('.login-auth-submit')?.closest('.dark')) === dark, theme === 'dark');
            for (const state of ['normal', 'hover']) {
                if (state === 'hover') await button.hover();
                else await page.mouse.move(0, 0);
                const style = await button.evaluate(element => {
                    const computed = getComputedStyle(element);
                    return {
                        origin: computed.backgroundOrigin, repeat: computed.backgroundRepeat,
                        clip: computed.backgroundClip, image: computed.backgroundImage,
                        leftWidth: computed.borderLeftWidth, rightWidth: computed.borderRightWidth,
                        leftColor: computed.borderLeftColor, rightColor: computed.borderRightColor
                    };
                });
                const label = `${theme}/${state}`;
                assert.equal(style.origin, 'border-box', `${label} 渐变必须覆盖透明边框区域`);
                assert.equal(style.repeat, 'no-repeat', `${label} 渐变不得在左右边框重复平铺`);
                assert.equal(style.clip, 'border-box', `${label} 背景绘制不得裁掉边框区域`);
                assert.match(style.image, /linear-gradient\(/, `${label} 必须保留登录按钮渐变`);
                assert.equal(style.leftWidth, '1px', `${label} 保留公共按钮的透明边框`);
                assert.equal(style.rightWidth, '1px', `${label} 左右边框宽度必须一致`);
                assert.equal(style.leftColor, 'rgba(0, 0, 0, 0)', `${label} 不得出现有色左边框`);
                assert.equal(style.rightColor, 'rgba(0, 0, 0, 0)', `${label} 不得出现有色右边框`);
            }
            assert.equal(await button.isEnabled(), true, `${theme} 登录按钮保持可用`);
            assert.equal(await page.locator('#login-username').inputValue(), 'visual-regression-user', '切换主题不得重置用户名');
            assert.equal(await page.locator('#login-password').inputValue(), 'fixture-password', '切换主题不得重置密码');
            await page.screenshot({ path: path.join(screenshotDir, `login-button-${theme}.png`), fullPage: true });
        }
        assert.deepEqual(cspViolations, [], '日夜主题切换不得产生 CSP 违规');
        assert.deepEqual(otherConsole, [], '登录页面不得出现运行时或控制台错误');
    } finally { await context.close(); }
});

test('生产响应头下：无 CSP 违规，服务端确认前不显示旧缓存壁纸，确认后仅传输一次', async () => {
    const context = await browser.newContext();
    await seedSiteConfig(context, VALID_GLOBAL_THEME);
    const page = await context.newPage();
    const { cspViolations, otherConsole } = collectPageErrors(page);

    const wallpaperRequests = [];
    let preMainBundleSnapshot = null;
    page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith(`${ORIGIN}/api/wallpapers/`)) wallpaperRequests.push(url);
    });
    await page.route(/\/assets\/.+\.js$/, async (route) => {
        if (!preMainBundleSnapshot) {
            preMainBundleSnapshot = await page.evaluate(() => ({
                preload: document.querySelector('link[rel="preload"][as="image"]')?.href ?? null,
                readyState: document.readyState
            }));
        }
        await route.continue();
    });

    const response = await page.goto(baseUrl, { waitUntil: 'load' });
    assert.ok(response, '页面必须加载成功');
    const cspHeader = response.headers()['content-security-policy'];
    assert.ok(typeof cspHeader === 'string' && cspHeader.includes('\n'),
        `HTML 响应必须携带两个 CSP 头（worker + _headers，Chromium 合并为 \\n 分隔），实际：${JSON.stringify(cspHeader)}`);
    const [workerCspHeader, pagesCspHeader] = cspHeader.split('\n');
    assert.equal(workerCspHeader, workerCsp, '响应 worker CSP 必须与源码数组一致');
    assert.ok(pagesCspHeader.includes(scriptSrcOf(pagesCsp)), '响应 _headers CSP 必须与源码一致');
    assert.equal(cspViolations.length, 0, `控制台出现 CSP 违规：${JSON.stringify(cspViolations)}`);
    assert.equal(otherConsole.length, 0,
        `页面出现运行时或控制台错误：${JSON.stringify(otherConsole)}`);
    const preloadHref = await page.evaluate(
        () => document.querySelector('link[rel="preload"][as="image"]')?.href ?? null
    );
    assert.equal(preloadHref, null, '服务端确认前不得创建壁纸 preload');
    assert.ok(preMainBundleSnapshot, '必须在主 bundle 请求被暂停时完成快照');
    assert.equal(preMainBundleSnapshot.preload, null,
        'React 主 bundle 执行前不得预加载本地缓存壁纸');
    assert.equal(preMainBundleSnapshot.readyState, 'interactive',
        '主 bundle 请求时文档必须已解析完成（模块脚本尚未执行）');

    // 单个 <img>（渐进式完整图）加载完成。
    await page.waitForFunction(
        (src) => {
            const image = Array.from(document.images).find(image => image.src === src);
            return image && image.naturalWidth > 0;
        },
        EXPECTED_URL,
        { timeout: 10_000 }
    );

    assert.equal(wallpaperRequests.length, 1,
        `壁纸内容只允许 1 次传输（boot preload 与 <img> 复用同一 URL），实际 ${wallpaperRequests.length} 次`);
    assert.equal(wallpaperRequests[0], EXPECTED_URL, '唯一传输必须是规范内容 URL');
    assert.equal(
        await page.evaluate((src) => {
            const image = Array.from(document.images).find(image => image.src === src);
            return image ? image.src : null;
        }, EXPECTED_URL),
        EXPECTED_URL,
        'React <img> 必须复用与 boot preload 完全相同的 URL'
    );

    // 时序证明（确定性）：壁纸请求的调度时间不晚于主 bundle 响应
    // 完成（responseEnd 之后模块脚本才开始执行）。服务器对主 bundle 延迟
    // 150ms 响应，低优先级的壁纸请求必然先被调度。
    const timings = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const wallpaper = resources
            .filter((entry) => entry.name.includes('/api/wallpapers/8/content'))
            .sort((a, b) => a.startTime - b.startTime)[0];
        const mainJs = resources
            .filter((entry) => entry.name.includes('/assets/') && entry.name.endsWith('.js'))
            .sort((a, b) => a.startTime - b.startTime)[0];
        return {
            wallpaperStart: wallpaper ? wallpaper.startTime : null,
            mainJsStart: mainJs ? mainJs.startTime : null,
            mainJsResponseEnd: mainJs ? mainJs.responseEnd : null
        };
    });
    assert.ok(timings.wallpaperStart !== null && timings.mainJsStart !== null && timings.mainJsResponseEnd !== null,
        '必须存在壁纸与主 bundle 的 PerformanceResourceTiming');
    assert.ok(timings.wallpaperStart >= timings.mainJsResponseEnd,
        `壁纸请求开始 ${timings.wallpaperStart}ms 必须在主 bundle 响应完成 ${timings.mainJsResponseEnd}ms 之后（等待服务端配置确认）`);

    await context.close();
});

for (const [name, corruptTheme] of [
    ['非法 wallpaperId=0', { ...VALID_GLOBAL_THEME, wallpaperId: 0 }],
    ['非数字 wallpaperId', { ...VALID_GLOBAL_THEME, wallpaperId: 'abc' }],
    ['带空格的版本', { ...VALID_GLOBAL_THEME, wallpaperVersion: 'bad version' }],
    ['外部 URL 版本', { ...VALID_GLOBAL_THEME, wallpaperVersion: 'https://evil.example/payload' }],
    ['HTML 注入版本', { ...VALID_GLOBAL_THEME, wallpaperVersion: '<img src=x onerror=alert(1)>' }]
]) {
    test(`非法配置仍被拒绝：${name}`, async () => {
        const context = await browser.newContext();
        await seedSiteConfig(context, corruptTheme);
        const page = await context.newPage();
        const { cspViolations } = collectPageErrors(page);
        const wallpaperRequests = [];
        page.on('request', (request) => {
            if (request.url().includes('/api/wallpapers/')) wallpaperRequests.push(request.url());
        });
        // 服务端配置桩默认返回有效主题；非法用例中改为空配置，使 React
        // 侧不会派生壁纸请求。
        await page.route('**/api/config/site', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
        );
        const response = await page.goto(baseUrl, { waitUntil: 'load' });
        assert.ok(response, '页面必须加载成功');
        assert.equal(cspViolations.length, 0,
            `页面出现 CSP 违规：${JSON.stringify(cspViolations)}`);
        assert.equal(
            await page.evaluate(() => document.querySelector('link[rel="preload"][as="image"]')?.href ?? null),
            null,
            '非法配置不得创建图片 preload'
        );
        // 服务端未确认有效配置时不得有任何版本化请求。
        const versionedRequests = wallpaperRequests.filter((url) => /\/content\?v=/.test(url));
        assert.equal(versionedRequests.length, 0,
            `非法配置不得触发版本化壁纸请求，实际 ${JSON.stringify(versionedRequests)}`);
        await context.close();
    });
}

test('the default brand renders as a theme-aware vector wordmark with a one-time entrance', async () => {
    for (const scheme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: scheme });
        try {
            const page = await context.newPage();
            await page.route('**/api/config/site', route => route.fulfill({ json: { loginBrandName: 'mcgo.app', globalTheme: { effectMode: 'default', lightDark: scheme } } }));
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            const brand = page.locator('.login-navbar-brand');
            const wordmark = brand.locator('svg.brand-wordmark');
            await wordmark.waitFor();
            assert.equal(await wordmark.getAttribute('aria-label'), 'mcgo.app');
            assert.match(await brand.getAttribute('class'), /brand-intro/, 'the first render plays the entrance');
            const parts = await wordmark.evaluate(svg => [...svg.querySelectorAll('.brand-wordmark-part')].map(part => ({
                id: part.getAttribute('class').match(/--(\w+)$/)[1],
                pathLength: part.querySelector('path').getAttribute('d').length,
                animations: part.getAnimations().map(animation => animation.animationName)
            })));
            assert.deepEqual(parts.map(part => part.id), ['mc', 'go', 'app']);
            for (const part of parts) {
                assert.ok(part.pathLength > 1000, `${part.id} has traced outlines`);
                assert.equal(part.animations.length, 1, `${part.id} makes an entrance`);
            }
            const mcTop = await wordmark.evaluate(svg => getComputedStyle(svg.querySelector('.brand-wordmark-stop--mc-top')).stopColor);
            if (scheme === 'dark') {
                const [r, g, b] = mcTop.match(/\d+/g).map(Number);
                assert.ok(0.299 * r + 0.587 * g + 0.114 * b > 200, `"mc" is light in dark mode (${mcTop})`);
            } else {
                assert.equal(mcTop, 'rgb(20, 23, 61)', '"mc" keeps the original navy in light mode');
            }
        } finally {
            await context.close();
        }
    }
});
