// Turns a chosen file into a data URL the logo library accepts (≤100KB,
// PNG/JPEG/WebP/GIF/AVIF). Larger still images and SVG imports are
// re-encoded in the browser; GIFs stay in their original format.
export const LOGO_MAX_BYTES = 100 * 1024;
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const SVG_TYPE = 'image/svg+xml';
export const LOGO_FILE_ACCEPT = [...SUPPORTED_TYPES, SVG_TYPE, '.svg'].join(',');
const MAX_EDGE = 512;
const SVG_EDGE = 1024;

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

async function loadSvgImage(file) {
    const document = new DOMParser().parseFromString(await file.text(), SVG_TYPE);
    const svg = document.documentElement;
    if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') {
        throw new Error('无法解析 SVG，请检查文件后重新选择');
    }

    const { width, height } = svg.viewBox.baseVal;
    const needsViewport = ['width', 'height'].some(axis => !svg.hasAttribute(axis) || svg.getAttribute(axis).trim().endsWith('%'));
    if (needsViewport && width > 0 && height > 0) {
        const scale = SVG_EDGE / Math.max(width, height);
        svg.setAttribute('width', String(Math.max(1, Math.round(width * scale))));
        svg.setAttribute('height', String(Math.max(1, Math.round(height * scale))));
    }

    // Decode in image mode and upload only the raster output.
    const source = new XMLSerializer().serializeToString(svg);
    return loadImage(new Blob([source], { type: SVG_TYPE }));
}

export async function prepareLogoDataUrl(file) {
    const isSvg = file?.type === SVG_TYPE || /\.svg$/i.test(file?.name || '');
    if (!file || (!isSvg && !SUPPORTED_TYPES.has(file.type))) {
        throw new Error('仅支持 SVG、PNG、JPEG、WebP、GIF 或 AVIF 图片');
    }
    if (!isSvg && file.size <= LOGO_MAX_BYTES) return readAsDataUrl(file);
    if (!isSvg && file.type === 'image/gif') throw new Error('GIF 动图不能超过 100KB，请先压缩后再上传');

    const image = isSvg ? await loadSvgImage(file) : await loadImage(file);
    const sourceEdge = Math.max(image.naturalWidth, image.naturalHeight);
    let edge = isSvg ? SVG_EDGE : Math.min(MAX_EDGE, sourceEdge);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const scale = edge / sourceEdge;
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
