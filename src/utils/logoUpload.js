// Turns a chosen file into a data URL the logo library accepts (≤100KB,
// PNG/JPEG/WebP/GIF/AVIF). Larger still images are scaled down in the
// browser; animated GIFs cannot be re-encoded without losing frames.
export const LOGO_MAX_BYTES = 100 * 1024;
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const MAX_EDGE = 512;

function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
        reader.readAsDataURL(blob);
    });
}

function loadImage(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解析该图片，请换一张试试')); };
        image.src = url;
    });
}

function encode(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareLogoDataUrl(file) {
    if (!file || !SUPPORTED_TYPES.has(file.type)) {
        throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片');
    }
    if (file.size <= LOGO_MAX_BYTES) return readAsDataUrl(file);
    if (file.type === 'image/gif') throw new Error('GIF 动图不能超过 100KB，请先压缩后再上传');

    const image = await loadImage(file);
    let edge = Math.min(MAX_EDGE, Math.max(image.naturalWidth, image.naturalHeight));
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const scale = edge / Math.max(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        // WebP keeps transparency; fall back to PNG where WebP encoding is unavailable.
        let blob = await encode(canvas, 'image/webp', 0.9);
        if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/png');
        if (blob && blob.size <= LOGO_MAX_BYTES) return readAsDataUrl(blob);
        edge = Math.round(edge * 0.7);
    }
    throw new Error('图片压缩后仍超过 100KB，请换一张更简单的图片');
}

export const libraryLogoUrl = id => `/api/logo-library/${id}/image`;
