// 服务端壁纸主题色：在壁纸落库时计算并存储，而不是等访客浏览器
// 解码图片后才提取。算法与前端完全一致（deriveImageTheme），
// Bing 预览图是 JPEG，用 jpeg-js 纯 JS 解码（Worker 兼容，无原生依赖）。
import { decode as decodeJpeg } from 'jpeg-js';
import { deriveImageTheme } from '../../src/utils/imageTheme.js';
import { THEMES } from '../../src/constants/themes.js';

export const THEME_ACCENT_RGB_PATTERN = /^\d{1,3}( \d{1,3}){2}$/;

// 校验客户端（上传）或服务端计算出的 accent 形状。
export function normalizeThemeAccent(value) {
    if (!value || typeof value !== 'object') return null;
    const { rgb, themeKey } = value;
    if (typeof rgb !== 'string' || !THEME_ACCENT_RGB_PATTERN.test(rgb)) return null;
    const channels = rgb.split(' ').map(Number);
    if (channels.some((channel) => channel < 0 || channel > 255)) return null;
    if (typeof themeKey !== 'string' || !THEMES[themeKey]) return null;
    return { rgb, themeKey };
}

// 从 JPEG 字节解码出主题色（解码前先做最近邻降采样到 ≤120px，
// 与前端 extractImageThemeFromElement 的采样口径一致）。
export function computeWallpaperAccentFromJpeg(bytes) {
    let decoded;
    try {
        decoded = decodeJpeg(bytes, { useTArray: true });
    } catch (error) {
        throw new Error(`JPEG 解码失败: ${error.message}`);
    }
    const { width, height, data } = decoded;
    const maxDimension = 120;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const sampled = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y += 1) {
        const sourceY = Math.min(height - 1, Math.floor(y / scale));
        for (let x = 0; x < targetWidth; x += 1) {
            const sourceX = Math.min(width - 1, Math.floor(x / scale));
            const sourceIndex = (sourceY * width + sourceX) * 4;
            const targetIndex = (y * targetWidth + x) * 4;
            sampled[targetIndex] = data[sourceIndex];
            sampled[targetIndex + 1] = data[sourceIndex + 1];
            sampled[targetIndex + 2] = data[sourceIndex + 2];
            sampled[targetIndex + 3] = data[sourceIndex + 3];
        }
    }
    const { rgb, themeKey } = deriveImageTheme(sampled);
    return { rgb, themeKey };
}
