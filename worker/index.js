import express from '../server/compat/express.js';
import { runWithRuntime } from '../server/config/runtime.js';
import { createOfficialTokenStore } from '../server/utils/officialCompat/tokenStore.js';

import authRoutes from '../server/routes/auth.js';
import competitionRoutes from '../server/routes/competitions.js';
import userRoutes from '../server/routes/users.js';
import ssoRoutes from '../server/routes/sso.js';
import ssoConfigRoutes from '../server/routes/ssoConfig.js';
import siteConfigRoutes from '../server/routes/siteConfig.js';
import contentRoutes from '../server/routes/content.js';
import aiRoutes from '../server/routes/ai.js';
import databaseRoutes from '../server/routes/database.js';
import accountManagementRoutes from '../server/routes/accountManagement.js';
import logoLibraryRoutes from '../server/routes/logoLibrary.js';
import wallpaperRoutes from '../server/routes/wallpapers.js';
import emailSettingsRoutes from '../server/routes/emailSettings.js';
import paasV2Routes from '../server/routes/paasV2.js';
import { syncLatestBingWallpaper } from '../server/services/wallpaperService.js';

const app = express();
// This is a request-independent, best-effort optimization cache.  It is
// passed explicitly through the runtime context; correctness never depends
// on its survival because an evicted isolate simply fetches a new token.
const workerOfficialTokenStore = createOfficialTokenStore();
app.use('/api/auth', authRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sso', ssoRoutes);
app.use('/api/sso-config', ssoConfigRoutes);
app.use('/api/config/site', siteConfigRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/account-management', accountManagementRoutes);
app.use('/api/logo-library', logoLibraryRoutes);
app.use('/api/wallpapers', wallpaperRoutes);
app.use('/api/email-settings', emailSettingsRoutes);
app.use('/api/paas-v2', paasV2Routes);
app.get('/api/health', (_req, res) => res.json({ ok: true, runtime: 'cloudflare-workers', database: 'd1' }));

function allowedOrigins(env) {
    return new Set(String(env.CORS_ORIGINS || 'https://marchcenter.top,http://localhost:5173,http://127.0.0.1:5173')
        .split(',').map(value => value.trim()).filter(Boolean));
}

function withSecurityHeaders(response, request, env) {
    const headers = new Headers(response.headers);
    if (!headers.has('Content-Security-Policy')) headers.set(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'self'",
            "form-action 'self' https: http:",
            "frame-src https://*.amap.com",
            "script-src 'self' https://static.cloudflareinsights.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' https:",
            "media-src 'self' blob: https:",
            "worker-src 'self' blob:",
            "manifest-src 'self'"
        ].join('; ')
    );
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'SAMEORIGIN');
    if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    const origin = request.headers.get('Origin');
    if (origin && allowedOrigins(env).has(origin)) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withEntryDocumentHeaders(response) {
    const headers = new Headers(response.headers);
    // 入口 HTML 必须重新校验，否则边缘节点可能继续提供引用旧
    // hash chunk 的页面；带 hash 的 JS/CSS 则可以长期 immutable 缓存。
    headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    headers.set('CDN-Cache-Control', 'no-store');
    headers.set('Pragma', 'no-cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function wallpaperCacheDebugEnabled(env) {
    // 调试头只应在开发/调试环境输出：wrangler dev（NODE_ENV 未设）默认开启，
    // 生产默认关闭，可通过 WALLPAPER_CACHE_DEBUG=1 临时开启做节点实测。
    return env.WALLPAPER_CACHE_DEBUG === '1' || (env.NODE_ENV || 'development') !== 'production';
}

async function serveWallpaper(request, env, id, ctx) {
    if (!env.WALLPAPERS) {
        const response = Response.json({ error: '壁纸存储尚未配置' }, { status: 503 });
        if (wallpaperCacheDebugEnabled(env)) response.headers.set('X-MarchCenter-Cache', 'R2');
        return response;
    }
    // 严格规范化：只有查询参数恰好等于唯一的 v=<content_hash> 才视为规范
    // URL。无版本、错误版本、正确版本 + 附加参数、重复 v 参数一律 307 到
    // 规范 URL，防止随机查询参数制造无限缓存条目（Worker Cache API 与
    // CDN 默认缓存键都包含完整查询串）。307 显式 no-store，避免未来
    // “Cache Everything”类规则把重定向也缓存下来。先查 D1 取得
    // content_hash（命中路径也仅多一次 ~0.3ms 的 D1 查询，不读 R2）。
    const row = await env.DB.prepare(
        `SELECT object_key, content_type, byte_size, content_hash
         FROM wallpaper_library WHERE id = ?`
    ).bind(id).first();
    if (!row) {
        const response = Response.json({ error: '壁纸不存在' }, { status: 404 });
        if (wallpaperCacheDebugEnabled(env)) response.headers.set('X-MarchCenter-Cache', 'MISS');
        return response;
    }

    const url = new URL(request.url);
    const canonical = new URL(`/api/wallpapers/${id}/content?v=${row.content_hash}`, url.origin);
    if (
        url.searchParams.get('v') !== row.content_hash
        || url.searchParams.size !== 1
    ) {
        return new Response(null, {
            status: 307,
            headers: {
                Location: canonical.toString(),
                'Cache-Control': 'no-store'
            }
        });
    }

    // 边缘缓存：只有严格规范 URL（唯一 v=正确哈希）才允许进入 Cache API，
    // 缓存键即规范 URL，CDN 层缓存键与之完全一致，全链路收敛无碎片。
    const cacheKey = new Request(canonical);
    const cachedResponse = await caches.default.match(cacheKey);
    if (cachedResponse) {
        // Cache API 返回的响应 headers 是 immutable 守卫，不能原地修改；
        // 调试模式下克隆一份再注入 HIT 标记。
        if (!wallpaperCacheDebugEnabled(env)) return cachedResponse;
        const debugResponse = new Response(cachedResponse.body, cachedResponse);
        debugResponse.headers.set('X-MarchCenter-Cache', 'HIT');
        return debugResponse;
    }

    const object = request.method === 'HEAD'
        ? await env.WALLPAPERS.head(row.object_key)
        : await env.WALLPAPERS.get(row.object_key);
    if (!object) {
        const response = Response.json({ error: '壁纸文件不存在' }, { status: 404 });
        if (wallpaperCacheDebugEnabled(env)) response.headers.set('X-MarchCenter-Cache', 'R2');
        return response;
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', row.content_type);
    headers.set('Content-Length', String(row.byte_size));
    // s-maxage 让 Cloudflare 边缘缓存该 Worker 响应，避免每个边缘节点
    // 首次访问都回源 R2；max-age 供浏览器本地缓存（URL 含版本参数，内容
    // 变化即 URL 变化，immutable 一年缓存是安全的）。
    headers.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    headers.set('Content-Disposition', 'inline');
    headers.set('ETag', object.httpEtag);
    if (wallpaperCacheDebugEnabled(env)) headers.set('X-MarchCenter-Cache', 'MISS');
    if (request.headers.get('If-None-Match') === object.httpEtag) {
        return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD' || !object.body) {
        return new Response(null, { status: 200, headers });
    }
    const [clientBody, cacheBody] = object.body.tee();
    const clientResponse = new Response(clientBody, { status: 200, headers });
    const cacheResponse = new Response(cacheBody, { status: 200, headers });
    // 缓存填充必须在后台执行，不能阻塞当前客户端接收图片流：
    // 立即返回客户端响应，缓存在 waitUntil 中继续，失败也不影响当前请求。
    ctx.waitUntil(
        caches.default.put(cacheKey, cacheResponse).catch(() => {})
    );
    return clientResponse;
}

export default {
    async fetch(request, env, ctx) {
        const services = env.OFFICIAL_TOKEN_CACHE_SCOPE === 'request'
            ? {}
            : { officialTokenStore: workerOfficialTokenStore };
        return runWithRuntime(env, ctx, async () => {
            const url = new URL(request.url);
            const origin = request.headers.get('Origin');

            if (request.method === 'OPTIONS') {
                if (origin && !allowedOrigins(env).has(origin)) {
                    return new Response('Origin not allowed', { status: 403 });
                }
                return withSecurityHeaders(new Response(null, { status: 204 }), request, env);
            }

            if (url.pathname.startsWith('/api/')) {
                const wallpaperMatch = url.pathname.match(/^\/api\/wallpapers\/(\d+)\/content$/);
                const contentLength = Number(request.headers.get('Content-Length') || 0);
                // 上传与替换都允许 13MB（路由内部再按 12MB 图面上限校验）；其余 API 1MB。
                const isWallpaperUploadOrReplace = url.pathname === '/api/wallpapers/upload'
                    || /^\/api\/wallpapers\/\d+\/replace$/.test(url.pathname);
                const bodyLimit = isWallpaperUploadOrReplace
                    ? 13 * 1024 * 1024
                    : 1024 * 1024;
                if (contentLength > bodyLimit) {
                    const limitText = bodyLimit > 1024 * 1024 ? '12MB' : '1MB';
                    return withSecurityHeaders(Response.json({ error: `请求内容不能超过 ${limitText}` }, { status: 413 }), request, env);
                }
                if (origin && !allowedOrigins(env).has(origin)) {
                    return withSecurityHeaders(Response.json({ error: 'Origin not allowed by CORS' }, { status: 403 }), request, env);
                }
                if (wallpaperMatch && ['GET', 'HEAD'].includes(request.method)) {
                    const response = await serveWallpaper(request, env, Number(wallpaperMatch[1]), ctx);
                    return withSecurityHeaders(response, request, env);
                }
                const response = await app.handle(request, { bodyLimitBytes: bodyLimit })
                    || Response.json({ error: '接口不存在' }, { status: 404 });
                return withSecurityHeaders(response, request, env);
            }

            // Some browsers and extensions still probe the legacy ICO path even
            // though the document declares an SVG icon. Keep that probe quiet and
            // reuse the canonical brand asset instead of maintaining two icons.
            if (url.pathname === '/favicon.ico' && ['GET', 'HEAD'].includes(request.method)) {
                return withSecurityHeaders(Response.redirect(`${url.origin}/favicon.svg`, 308), request, env);
            }

            if (!env.ASSETS) return new Response('MarchCenter Worker is running', { status: 200 });
            const assetResponse = await env.ASSETS.fetch(request);
            if (assetResponse.status !== 404) {
                const entryResponse = url.pathname === '/' || url.pathname === '/index.html'
                    ? withEntryDocumentHeaders(assetResponse)
                    : assetResponse;
                return withSecurityHeaders(entryResponse, request, env);
            }
            // not_found_handling 为 none：只有无文件扩展名的 GET 导航请求才
            // 回退到 SPA 的 index.html；带 hash 的静态资源（/assets/*.js|css）
            // 一律返回真实 404，绝不把 HTML 当脚本/样式交给浏览器。
            if (
                request.method === 'GET'
                && !/\.[A-Za-z0-9_-]{1,10}$/.test(url.pathname)
            ) {
                const spaDocument = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, request));
                return withSecurityHeaders(withEntryDocumentHeaders(spaDocument), request, env);
            }
            return withSecurityHeaders(assetResponse, request, env);
        }, services);
    },

    async scheduled(_controller, env, ctx) {
        await runWithRuntime(env, ctx, async () => {
            try {
                const result = await syncLatestBingWallpaper({ selectWhenEnabled: true });
                console.log('Bing wallpaper sync completed', {
                    wallpaperId: result.wallpaper?.id,
                    sourceDate: result.wallpaper?.source_date,
                    selected: result.selected
                });
            } catch (error) {
                console.error('Scheduled Bing wallpaper sync failed:', error);
                throw error;
            }
        });
    }
};
