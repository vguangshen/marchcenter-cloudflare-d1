import { getRuntime } from '../config/runtime.js';
import {
    computeWallpaperAccentFromJpeg,
    normalizeThemeAccent
} from '../utils/wallpaperAccent.js';

export const MAX_WALLPAPER_BYTES = 12 * 1024 * 1024;
// 官方 Bing 每日壁纸归档接口（JSON），不再依赖第三方镜像站点抓取 HTML。
// idx=0 为今日、n=1 取一张、mkt=zh-CN 返回中文区壁纸与 copyright 文案。
export const BING_ARCHIVE_API = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN';
const BING_ORIGIN = 'https://cn.bing.com';

const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif']
]);

export function validateBingImageUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'cn.bing.com'
    || url.pathname !== '/th'
    || url.port
    || url.username
    || url.password
  ) {
    throw new Error('Bing 壁纸地址不可信');
  }
  return url.toString();
}

export function withLoginSize(value) {
  // 官方 /th 源图默认 3840×2160（约 1.2MB），登录/仪表盘背景用 1920 宽
  // 足够清晰，存储体积与首屏加载时间可减少约 2/3。
  // 必须用 URL API 覆盖而非追加参数：Bing 链接本身可能已携带 w=/h=，
  // 直接拼接 &w=1920 会产生重复参数，服务端仍可能返回 4K 原图。
  const url = new URL(value);
  url.searchParams.set('w', '1920');
  url.searchParams.set('h', '1080');
  return url.toString();
}

// 官方接口返回结构：images[0] 含相对 url（/th?id=..._1920x1080.jpg&rf=...&pid=hp）、
// startdate（YYYYMMDD）与 copyright/title 文案。日期在此统一转成
// YYYY-MM-DD，与数据库 source_date 及既有去重逻辑保持一致。
export function parseLatestBingWallpaper(payload) {
  const images = payload?.images;
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('未能从 Bing 官方接口解析最新壁纸');
  }
  const image = images[0];
  const rawUrl = String(image?.url || '');
  const imageUrl = validateBingImageUrl(
    /^https?:\/\//.test(rawUrl) ? rawUrl : `${BING_ORIGIN}${rawUrl}`
  );
  const rawDate = String(image?.startdate || '').trim();
  if (!/^\d{8}$/.test(rawDate)) {
    throw new Error('Bing 壁纸日期格式无效');
  }
  const sourceDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
  const title = String(
    image?.copyright || image?.title || `Bing 每日壁纸 ${sourceDate}`
  ).trim().slice(0, 160);
  return { imageUrl, sourceDate, title };
}

export function normalizeWallpaperContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

export function assertAllowedWallpaperType(contentType) {
  const normalized = normalizeWallpaperContentType(contentType);
  if (!ALLOWED_IMAGE_TYPES.has(normalized)) {
    throw new Error('仅支持 JPG、PNG、WebP 或 AVIF 图片');
  }
  return normalized;
}

export function assertWallpaperBytesMatchType(bytes, contentType) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const normalized = assertAllowedWallpaperType(contentType);
  const matches = {
    'image/jpeg': input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff,
    'image/png': input.length >= 8
      && input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47
      && input[4] === 0x0d && input[5] === 0x0a && input[6] === 0x1a && input[7] === 0x0a,
    'image/webp': input.length >= 12
      && String.fromCharCode(...input.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...input.slice(8, 12)) === 'WEBP',
    'image/avif': input.length >= 12
      && String.fromCharCode(...input.slice(4, 8)) === 'ftyp'
      && ['avif', 'avis'].includes(String.fromCharCode(...input.slice(8, 12)))
  }[normalized];
  if (!matches) throw new Error('图片内容与声明格式不一致或文件已损坏');
  return normalized;
}

function safeTitle(value, fallback) {
  return String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 160) || fallback;
}

async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function requireWallpaperRuntime() {
  const { env } = getRuntime();
  if (!env?.DB || !env?.WALLPAPERS) {
    throw new Error('壁纸存储尚未配置');
  }
  return env;
}

async function readBoundedArrayBuffer(response, maxBytes) {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Bing 壁纸文件超过 ${maxBytes / 1024 / 1024}MB 限制`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function findWallpaperById(env, id) {
  return env.DB.prepare(`
    SELECT id, object_key, source_type, source_date, title, source_url,
           content_type, byte_size, content_hash,
           theme_accent,
           created_by, created_at
    FROM wallpaper_library
    WHERE id = ?
  `).bind(id).first();
}

export async function listWallpapers(limit = 80) {
  const env = requireWallpaperRuntime();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 120));
  const result = await env.DB.prepare(`
    SELECT id, source_type, source_date, title, source_url,
           content_type, byte_size, content_hash,
           theme_accent,
           created_by, created_at
    FROM wallpaper_library
    ORDER BY
      CASE WHEN source_type = 'bing' THEN 0 ELSE 1 END,
      COALESCE(source_date, created_at) DESC,
      id DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return result.results || [];
}

// 主题色落库：优先用客户端随上传提交的 accent；否则服务端从 JPEG
// 内容字节解码计算（Bing 路径，落库时一次性完成）。失败绝不影响保存。
async function attachAccentFromJpeg(env, wallpaperId, bytes) {
  try {
    const accent = computeWallpaperAccentFromJpeg(bytes);
    await env.DB.prepare('UPDATE wallpaper_library SET theme_accent = ? WHERE id = ?')
      .bind(JSON.stringify(accent), wallpaperId).run();
    return accent;
  } catch (error) {
    console.warn('Wallpaper accent computation failed, continuing without accent:', error.message);
    return null;
  }
}

export async function saveWallpaper({
  bytes,
  contentType,
  sourceType,
  sourceDate = null,
  sourceUrl = null,
  title,
  createdBy = null,
  accent = null
}) {
  const env = requireWallpaperRuntime();
  const normalizedType = assertAllowedWallpaperType(contentType);
  const body = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  if (!body.byteLength || body.byteLength > MAX_WALLPAPER_BYTES) {
    throw new Error(`壁纸大小必须在 1 字节到 ${MAX_WALLPAPER_BYTES / 1024 / 1024}MB 之间`);
  }
  assertWallpaperBytesMatchType(body, normalizedType);
  if (!['bing', 'upload'].includes(sourceType)) {
    throw new Error('壁纸来源无效');
  }

  const clientAccent = normalizeThemeAccent(accent);

  if (sourceType === 'bing' && sourceDate) {
    const existing = await env.DB.prepare(
      'SELECT id FROM wallpaper_library WHERE source_type = ? AND source_date = ?'
    ).bind('bing', sourceDate).first();
    if (existing?.id) {
      const found = await findWallpaperById(env, existing.id);
      if (!found.theme_accent && clientAccent) {
        await env.DB.prepare('UPDATE wallpaper_library SET theme_accent = ? WHERE id = ?')
          .bind(JSON.stringify(clientAccent), found.id).run();
        return findWallpaperById(env, found.id);
      }
      return found;
    }
  }

  const hash = await sha256Hex(body);
  const duplicate = await env.DB.prepare(
    'SELECT id FROM wallpaper_library WHERE content_hash = ?'
  ).bind(hash).first();
  if (duplicate?.id) {
    const found = await findWallpaperById(env, duplicate.id);
    if (!found.theme_accent && clientAccent) {
      await env.DB.prepare('UPDATE wallpaper_library SET theme_accent = ? WHERE id = ?')
        .bind(JSON.stringify(clientAccent), found.id).run();
      return findWallpaperById(env, found.id);
    }
    return found;
  }

  const extension = ALLOWED_IMAGE_TYPES.get(normalizedType);
  const datePart = sourceDate || new Date().toISOString().slice(0, 10);
  const objectKey = `wallpapers/${sourceType}/${datePart}-${hash.slice(0, 20)}.${extension}`;
  const fallbackTitle = sourceType === 'bing' ? `Bing 每日壁纸 ${datePart}` : '自定义壁纸';

  await env.WALLPAPERS.put(objectKey, body, {
    httpMetadata: {
      contentType: normalizedType,
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: {
      sourceType,
      sourceDate: sourceDate || '',
      contentHash: hash
    }
  });

  try {
    const result = await env.DB.prepare(`
      INSERT INTO wallpaper_library (
        object_key, source_type, source_date, title, source_url,
        content_type, byte_size, content_hash,
        theme_accent,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      objectKey,
      sourceType,
      sourceDate,
      safeTitle(title, fallbackTitle),
      sourceUrl,
      normalizedType,
      body.byteLength,
      hash,
      clientAccent ? JSON.stringify(clientAccent) : null,
      createdBy
    ).run();
    const rowId = result.meta.last_row_id;
    // 没有客户端 accent 且内容是 JPEG（Bing 路径）：落库时从内容解码
    // 计算主题色（一次性，非请求路径转码）。
    if (!clientAccent && normalizedType === 'image/jpeg') {
      await attachAccentFromJpeg(env, rowId, body);
    }
    return findWallpaperById(env, rowId);
  } catch (error) {
    // 并发同步（每日 cron 与手动触发重叠）时，后提交者的 INSERT 会命中
    // content_hash/object_key 的 UNIQUE 约束进入这里；此时 R2 对象与
    // 先提交者共享同一个 objectKey，绝不能删除——否则会删掉胜出者行
    // 正在引用的壁纸，客户端将拿到持久 404。只有确认没有任何行引用
    // 该对象时才清理孤儿对象并重新抛出。
    const existing = await env.DB.prepare(
      'SELECT id FROM wallpaper_library WHERE content_hash = ?'
    ).bind(hash).first();
    if (existing?.id) return findWallpaperById(env, existing.id);
    await env.WALLPAPERS.delete(objectKey);
    throw error;
  }
}

/**
 * 壁纸内容 URL 带稳定版本参数。
 * 版本即内容的 SHA-256（content_hash）：新上传或未来同 ID 替换内容都会
 * 产生新的版本，因此 URL 变化 ⇒ Cache API 键变化 ⇒ 新内容永远不会命中
 * 旧版本的边缘缓存条目，跨数据中心正确性由 URL 本身保证。
 */
export function wallpaperContentUrl(id, version, origin = '') {
  const base = origin ? `${origin}/api/wallpapers/${id}/content` : `/api/wallpapers/${id}/content`;
  const versionSuffix = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${base}${versionSuffix}`;
}

export async function getSiteGlobalConfig(env) {
  const row = await env.DB.prepare(
    'SELECT config_value FROM system_configs WHERE config_key = ?'
  ).bind('site_global').first();
  if (!row?.config_value) return {};
  try {
    return JSON.parse(row.config_value);
  } catch {
    return {};
  }
}

export async function saveSiteGlobalConfig(env, config) {
  await env.DB.prepare(`
    INSERT INTO system_configs (config_key, config_value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(config_key) DO UPDATE SET
      config_value = excluded.config_value,
      updated_at = CURRENT_TIMESTAMP
  `).bind('site_global', JSON.stringify(config)).run();
}

export async function selectWallpaperForBingMode(env, wallpaper) {
  const config = await getSiteGlobalConfig(env);
  const theme = config.globalTheme && typeof config.globalTheme === 'object'
    ? config.globalTheme
    : {};
  if (theme.backgroundMode !== 'bing') return false;
  if (theme.effectMode && theme.effectMode !== 'wallpaper') return false;

  config.globalTheme = {
    ...theme,
    effectMode: 'wallpaper',
    immersive: null,
    backgroundMode: 'bing',
    wallpaperId: Number(wallpaper.id)
  };
  await saveSiteGlobalConfig(env, config);
  return true;
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`${label}超时`, 'TimeoutError')), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}超时`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadLatestBingImage(latest) {
  const imageResponse = await fetchWithTimeout(withLoginSize(latest.imageUrl), {
    headers: { 'User-Agent': 'MarchCenter-Wallpaper-Engine/1.0' }
  }, 20_000, 'Bing 壁纸图片请求');
  if (!imageResponse.ok) {
    throw new Error(`Bing 壁纸图片请求失败 (${imageResponse.status})`);
  }
  const contentType = assertAllowedWallpaperType(imageResponse.headers.get('content-type'));
  const declaredSize = Number(imageResponse.headers.get('content-length') || 0);
  if (declaredSize > MAX_WALLPAPER_BYTES) throw new Error('Bing 壁纸文件超过 12MB 限制');
  let bytes = await readBoundedArrayBuffer(imageResponse, MAX_WALLPAPER_BYTES);
  assertWallpaperBytesMatchType(bytes, contentType);
  if (contentType === 'image/jpeg') {
    try {
      bytes = await optimizeBingJpeg(bytes);
    } catch (error) {
      console.warn('Bing progressive re-encode failed, storing original:', error.message);
    }
  }
  return { bytes, contentType };
}

async function recordBingSyncStatus(env, status) {
  try {
    await env.DB.prepare(`
      INSERT INTO system_configs (config_key, config_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = CURRENT_TIMESTAMP
    `).bind('bing_wallpaper_sync_status', JSON.stringify(status)).run();
  } catch (error) {
    console.warn('Bing sync status persistence failed:', error.message);
  }
}

export async function getBingSyncStatus() {
  const env = requireWallpaperRuntime();
  const row = await env.DB.prepare(
    'SELECT config_value, updated_at FROM system_configs WHERE config_key = ?'
  ).bind('bing_wallpaper_sync_status').first();
  if (!row?.config_value) return null;
  try { return { ...JSON.parse(row.config_value), updatedAt: row.updated_at }; }
  catch { return null; }
}

async function optimizeBingJpeg(bytes) {
  const { optimizeJpegProgressive } = await import('../utils/wallpaperProgressive.js');
  return optimizeJpegProgressive(bytes);
}

async function performLatestBingWallpaperSync({ selectWhenEnabled = true } = {}) {
  const env = requireWallpaperRuntime();
  const pageResponse = await fetchWithTimeout(BING_ARCHIVE_API, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MarchCenter-Wallpaper-Engine/1.0'
    }
  }, 10_000, 'Bing 壁纸接口请求');
  if (!pageResponse.ok) {
    throw new Error(`Bing 壁纸接口请求失败 (${pageResponse.status})`);
  }
  const latest = parseLatestBingWallpaper(await pageResponse.json());

  let wallpaper = await env.DB.prepare(
    'SELECT id FROM wallpaper_library WHERE source_type = ? AND source_date = ?'
  ).bind('bing', latest.sourceDate).first();
  if (wallpaper?.id) {
    wallpaper = await findWallpaperById(env, wallpaper.id);
    // 历史同步可能保存了 Bing 原始 baseline JPEG：自动重编码为
    // progressive，失败时保留原内容继续同步。
    let object = await env.WALLPAPERS.get(wallpaper.object_key);
    if (!object) {
      const downloaded = await downloadLatestBingImage(latest);
      wallpaper = await replaceWallpaperContent(wallpaper.id, downloaded);
      object = await env.WALLPAPERS.get(wallpaper.object_key);
    }
    if (wallpaper.content_type === 'image/jpeg') {
      try {
        if (object) {
          const currentBytes = new Uint8Array(await object.arrayBuffer());
          const optimized = await optimizeBingJpeg(currentBytes);
          if (optimized !== currentBytes) {
            wallpaper = await replaceWallpaperContent(
              wallpaper.id,
              { bytes: optimized, contentType: 'image/jpeg' }
            );
          }
        }
      } catch (error) {
        console.warn('Existing Bing wallpaper progressive upgrade failed, continuing:', error.message);
      }
    }
    // 历史壁纸可能没有主题色：从 R2 内容解码补算（尽力而为，
    // 失败不影响同步结果）。
    if (!wallpaper.theme_accent && wallpaper.content_type === 'image/jpeg') {
      try {
        const accentObject = await env.WALLPAPERS.get(wallpaper.object_key);
        if (accentObject) {
          const contentBytes = await accentObject.arrayBuffer();
          await attachAccentFromJpeg(env, wallpaper.id, contentBytes);
          wallpaper = await findWallpaperById(env, wallpaper.id);
        }
      } catch (error) {
        console.warn('Bing accent backfill failed, continuing without accent:', error.message);
      }
    }
  } else {
    const { bytes, contentType } = await downloadLatestBingImage(latest);

    wallpaper = await saveWallpaper({
      bytes,
      contentType,
      sourceType: 'bing',
      sourceDate: latest.sourceDate,
      sourceUrl: latest.imageUrl,
      title: latest.title
    });
  }

  const selected = selectWhenEnabled
    ? await selectWallpaperForBingMode(env, wallpaper)
    : false;
  return { wallpaper, selected };
}

export async function syncLatestBingWallpaper(options = {}) {
  const env = requireWallpaperRuntime();
  const startedAt = new Date().toISOString();
  await recordBingSyncStatus(env, { state: 'running', startedAt });
  try {
    const result = await performLatestBingWallpaperSync(options);
    await recordBingSyncStatus(env, {
      state: 'success', startedAt, finishedAt: new Date().toISOString(),
      wallpaperId: result.wallpaper?.id, sourceDate: result.wallpaper?.source_date,
      selected: result.selected
    });
    return result;
  } catch (error) {
    await recordBingSyncStatus(env, {
      state: 'error', startedAt, finishedAt: new Date().toISOString(),
      error: String(error?.message || error).slice(0, 300)
    });
    throw error;
  }
}

/**
 * 内容替换：保留壁纸行（id/source_date/title/主题色不变），仅替换 R2
 * 内容对象与 content_hash。content_hash 变化 ⇒ 版本化 URL 变化 ⇒ 前端与
 * 边缘缓存自动切到新内容（CDN/Cache API 旧条目由版本化 URL 自然隔离）。
 * 供自动 Bing 同步（MozJPEG WASM）与本地处理管线
 * （scripts/optimize-wallpapers.mjs，Sharp 渐进式 JPEG）把已有壁纸升级为
 * progressive 编码；Worker 请求路径不执行任何转码。
 */
export async function replaceWallpaperContent(id, { bytes, contentType }, { origin } = {}) {
  const env = requireWallpaperRuntime();
  const wallpaper = await findWallpaperById(env, id);
  if (!wallpaper) return null;
  const normalizedType = assertAllowedWallpaperType(contentType);
  const body = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (!body.byteLength || body.byteLength > MAX_WALLPAPER_BYTES) {
    throw new Error(`壁纸大小必须在 1 字节到 ${MAX_WALLPAPER_BYTES / 1024 / 1024}MB 之间`);
  }
  assertWallpaperBytesMatchType(body, normalizedType);

  const hash = await sha256Hex(body);
  if (hash === wallpaper.content_hash) {
    // 相同内容通常 no-op；但 D1 行存在而 R2 对象丢失时必须原位修复。
    const existingObject = await env.WALLPAPERS.head(wallpaper.object_key);
    if (!existingObject) {
      await env.WALLPAPERS.put(wallpaper.object_key, body, {
        httpMetadata: { contentType: normalizedType, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: {
          sourceType: wallpaper.source_type,
          sourceDate: wallpaper.source_date || '',
          contentHash: hash
        }
      });
    }
    return findWallpaperById(env, id);
  }

  const extension = ALLOWED_IMAGE_TYPES.get(normalizedType);
  const datePart = wallpaper.source_date || new Date().toISOString().slice(0, 10);
  const objectKey = `wallpapers/${wallpaper.source_type}/${datePart}-${hash.slice(0, 20)}.${extension}`;
  await env.WALLPAPERS.put(objectKey, body, {
    httpMetadata: {
      contentType: normalizedType,
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: {
      sourceType: wallpaper.source_type,
      sourceDate: wallpaper.source_date || '',
      contentHash: hash
    }
  });

  try {
    await env.DB.prepare(
      `UPDATE wallpaper_library
       SET object_key = ?, content_type = ?, byte_size = ?, content_hash = ?
       WHERE id = ?`
    ).bind(objectKey, normalizedType, body.byteLength, hash, id).run();
  } catch (error) {
    await env.WALLPAPERS.delete(objectKey);
    throw error;
  }

  // 旧对象按行级内容寻址（content_hash 唯一约束 ⇒ 只被本行引用），可安全删除。
  if (wallpaper.object_key && wallpaper.object_key !== objectKey) {
    try {
      await env.WALLPAPERS.delete(wallpaper.object_key);
    } catch {
      // 尽力而为，删除失败不影响新内容可用性。
    }
  }
  await purgeWallpaperEdgeCache(id, wallpaper.content_hash, origin);
  return findWallpaperById(env, id);
}

export async function deleteWallpaper(id, { origin } = {}) {
  const env = requireWallpaperRuntime();
  const wallpaper = await findWallpaperById(env, id);
  if (!wallpaper) return false;

  const config = await getSiteGlobalConfig(env);
  const theme = config.globalTheme && typeof config.globalTheme === 'object'
    ? config.globalTheme
    : {};
  const deletingActiveWallpaper = Number(theme.wallpaperId) === Number(id);
  if (deletingActiveWallpaper) {
    config.globalTheme = {
      ...theme,
      effectMode: 'default',
      immersive: null,
      backgroundMode: 'default',
      wallpaperId: null
    };
  }
  const statements = [];
  if (deletingActiveWallpaper) {
    statements.push(env.DB.prepare(`
      INSERT INTO system_configs (config_key, config_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = CURRENT_TIMESTAMP
    `).bind('site_global', JSON.stringify(config)));
  }
  statements.push(env.DB.prepare('DELETE FROM wallpaper_library WHERE id = ?').bind(id));
  await env.DB.batch(statements);
  try {
    await env.WALLPAPERS.delete(wallpaper.object_key);
  } catch (error) {
    console.warn('Wallpaper R2 cleanup failed after database delete:', error.message);
  }
  // 同步尽力失效边缘 Cache API 中该壁纸的缓存条目（当前版本与旧版无版本
  // 参数的历史条目）；caches.default.delete 只清理当前 Worker 所在数据中心，
  // 跨节点正确性由版本化 URL 保证：删除后站点配置不再引用该壁纸，
  // 任何客户端都不会再请求旧的版本化 URL。
  await purgeWallpaperEdgeCache(id, wallpaper.content_hash, origin);
  return true;
}

export async function purgeWallpaperEdgeCache(id, version, origin) {
  try {
    if (globalThis.caches?.default?.delete) {
      const base = origin || 'https://marchcenter.top';
      const keys = [
        wallpaperContentUrl(id, version, base),
        wallpaperContentUrl(id, null, base)
      ];
      await Promise.all(keys.map(key => globalThis.caches.default.delete(new Request(key))));
    }
  } catch {
    // 缓存失效是尽力而为；删除 R2 对象与数据库行已保证核心数据一致，
    // 版本化 URL 保证新配置永远不会命中旧缓存。
  }
}
