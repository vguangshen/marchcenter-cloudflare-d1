import { IMAGE_THEME_CACHE_VERSION } from './imageTheme.js';

const WALLPAPER_PATH_PATTERN = /\/wallpapers\/(\d+)\/content$/;

// 从壁纸内容/预览 URL 提取 wallpaperId。必须先用 URL 解析再匹配
// pathname，直接对整串 URL 用 /(\d+)\/content$/ 会匹配不到带 ?v=hash
// 的规范 URL。
const idFromUrl = (candidateUrl, pathPattern) => {
    if (typeof candidateUrl !== 'string' || !candidateUrl) return NaN;
    let parsed;
    try {
        parsed = new URL(candidateUrl, 'http://marchcenter.local');
    } catch {
        return NaN;
    }
    return Number(parsed.pathname.match(pathPattern)?.[1]);
};

export const wallpaperIdFromUrl = (candidateUrl) => idFromUrl(candidateUrl, WALLPAPER_PATH_PATTERN);

// 主题色缓存键包含壁纸版本：内容变化后旧版本的 accent 缓存自动作废，
// 新版本重新提取，不会把旧壁纸的配色误用到新壁纸上。
// 解析失败时返回 null，绝不产生含 NaN 的缓存键。
export const wallpaperAccentCacheKey = (candidateUrl) => {
    const wallpaperId = wallpaperIdFromUrl(candidateUrl);
    if (!Number.isInteger(wallpaperId) || wallpaperId <= 0) return null;
    let version = '';
    try {
        version = new URL(candidateUrl, 'http://marchcenter.local').searchParams.get('v') || '';
    } catch {
        return null;
    }
    return `marchcenter_wallpaper_accent_v${IMAGE_THEME_CACHE_VERSION}_${wallpaperId}_${version || 'unversioned'}`;
};
