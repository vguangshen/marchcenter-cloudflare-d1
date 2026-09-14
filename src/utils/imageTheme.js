import { THEMES } from '../constants/themes.js';

export const IMAGE_THEME_CACHE_VERSION = 3;

const FALLBACK_RGB = [59, 130, 246];
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.88;

const parseThemeRgb = (value) => String(value).split(/\s+/).map(Number);

const colorDistance = ([r1, g1, b1], [r2, g2, b2]) => (
    (2 * ((r1 - r2) ** 2))
    + (4 * ((g1 - g2) ** 2))
    + (3 * ((b1 - b2) ** 2))
);

export const nearestThemeKey = (rgb) => Object.entries(THEMES)
    .reduce((best, [key, theme]) => {
        const inputMetrics = colorMetrics(...rgb);
        const themeRgb = parseThemeRgb(theme.rgb);
        const themeMetrics = colorMetrics(...themeRgb);
        const hueDifference = Math.min(
            Math.abs(inputMetrics.hue - themeMetrics.hue),
            360 - Math.abs(inputMetrics.hue - themeMetrics.hue)
        );
        const distance = inputMetrics.saturation < 0.12
            ? colorDistance(rgb, themeRgb)
            : (
                (hueDifference ** 2) * 4
                + (((inputMetrics.saturation - themeMetrics.saturation) * 100) ** 2) * 0.25
                + (((inputMetrics.lightness - themeMetrics.lightness) * 100) ** 2) * 0.02
            );
        return distance < best.distance ? { key, distance } : best;
    }, { key: 'blue', distance: Number.POSITIVE_INFINITY }).key;

const colorMetrics = (r, g, b) => {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const delta = max - min;
    const saturation = delta === 0
        ? 0
        : delta / (1 - Math.abs((2 * lightness) - 1));
    let hue = 0;
    if (delta !== 0) {
        if (max === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
        else hue = 60 * (((red - green) / delta) + 4);
    }
    return { hue: (hue + 360) % 360, saturation, lightness };
};

const isBetterCandidate = (candidate, current) => {
    if (!current) return true;
    const saturationDifference = candidate.saturation - current.saturation;
    if (Math.abs(saturationDifference) > 1e-7) return saturationDifference > 0;
    if (candidate.support !== current.support) return candidate.support > current.support;
    return Math.abs(candidate.lightness - 0.5) < Math.abs(current.lightness - 0.5);
};

export const deriveImageTheme = (pixels) => {
    if (!pixels?.length) {
        return { rgb: FALLBACK_RGB.join(' '), themeKey: 'blue' };
    }

    // 相近像素只用于同饱和度时判断稳定性；最终返回值始终是图片中的原始 RGB。
    const buckets = new Map();
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 180) continue;
        const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
        const { saturation, lightness } = colorMetrics(...rgb);
        if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS) continue;

        const bucketKey = rgb.map((channel) => channel >> 4).join(',');
        const bucket = buckets.get(bucketKey) || {
            support: 0,
            saturation: -1,
            lightness: 0.5,
            rgb
        };
        bucket.support += 1;
        if (
            saturation > bucket.saturation
            || (
                Math.abs(saturation - bucket.saturation) <= 1e-7
                && Math.abs(lightness - 0.5) < Math.abs(bucket.lightness - 0.5)
            )
        ) {
            bucket.saturation = saturation;
            bucket.lightness = lightness;
            bucket.rgb = rgb;
        }
        buckets.set(bucketKey, bucket);
    }

    let winner = null;
    for (const candidate of buckets.values()) {
        if (isBetterCandidate(candidate, winner)) winner = candidate;
    }

    const rgb = winner?.rgb || FALLBACK_RGB;
    return {
        rgb: rgb.join(' '),
        themeKey: nearestThemeKey(rgb)
    };
};

/**
 * 从已加载完成的 Image 元素提取主题色，不再发起第二次网络请求。
 * 用于复用登录页壁纸预加载的同一个 Image 实例：一次下载、一次解码。
 */
export const extractImageThemeFromElement = (image) => {
    const maxDimension = 120;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // 最近邻缩放避免插值创造原图中不存在的新颜色。
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return deriveImageTheme(pixels);
};

export const extractImageTheme = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => {
        try {
            resolve(extractImageThemeFromElement(image));
        } catch (error) {
            reject(error);
        }
    };
    image.onerror = () => reject(new Error('壁纸颜色读取失败'));
    image.src = url;
});

/**
 * 从本地文件计算主题色 accent（同一 deriveImageTheme 算法），
 * 用于管理员上传时随表单提交（服务端落库，登录页图片加载前即应用）。
 * 返回 { rgb: 'r g b', themeKey } 或 null。
 */
export const extractThemeFromFile = (file, maxSize = 120) => new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
        resolve(null);
        return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
        try {
            const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.imageSmoothingEnabled = false;
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            cleanup();
            resolve(deriveImageTheme(pixels));
        } catch {
            cleanup();
            resolve(null);
        }
    };
    image.onerror = () => {
        cleanup();
        resolve(null);
    };
    image.src = objectUrl;
});
