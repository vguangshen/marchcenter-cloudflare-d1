// 真实浏览器 CSP E2E：加载 vite build 产物，通过 node http 服务器下发
// 与生产完全相同的两组 Content-Security-Policy（worker/index.js 的 CSP +
// public/_headers 的 CSP，浏览器会叠加强制执行两者的交集）。
//
// 覆盖验收：
//   1. 入口无经典内联脚本，控制台无 CSP 违规；
//   2. localStorage 旧配置不会在服务端确认前设置 preload；
//   3. React 收到公开配置后只请求一次规范壁纸 URL；
//   6. 非法 ID / 版本 / 外部 URL 仍被拒绝。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const distDir = path.join(projectRoot, 'dist');
const ORIGIN = 'http://localhost:8787';
const WALLPAPER_ID = 8;
const WALLPAPER_VERSION = 'v1testhash';
const EXPECTED_URL = `${ORIGIN}/api/wallpapers/${WALLPAPER_ID}/content?v=${WALLPAPER_VERSION}`;
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
    return line[1];
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
        server.listen(8787, '127.0.0.1', resolve);
    });
    baseUrl = ORIGIN;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
});

test('CSP 两个来源保持一致', () => {
    const workerScriptSrc = scriptSrcOf(workerCsp);
    const pagesScriptSrc = scriptSrcOf(pagesCsp);
    assert.equal(workerScriptSrc, pagesScriptSrc, '两个 CSP 来源的 script-src 必须完全一致');
    assert.doesNotMatch(workerScriptSrc, /unsafe-inline/, 'script-src 禁止使用 unsafe-inline');
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
            const image = document.querySelector(`img[src="${src}"]`);
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
            const image = document.querySelector(`img[src="${src}"]`);
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
