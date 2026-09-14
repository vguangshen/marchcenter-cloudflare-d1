// 轻量 JPEG 标记解析器（零依赖）：检测 baseline(SOF0) / progressive(SOF2)
// 编码类型、像素尺寸与 EXIF/ICC 元数据，供本地处理管线和测试共用。
// 输出 progressive JPEG 的确认工具：scripts/check-jpeg-progressive.mjs。

export function inspectJpeg(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    let sof = null;
    let hasExif = false;
    let hasIcc = false;
    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            offset += 2;
            continue;
        }
        if (marker === 0xd9) break;
        if (offset + 2 > bytes.length) break;
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (length < 2) break;
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3) {
            sof = {
                marker,
                height: (bytes[offset + 5] << 8) | bytes[offset + 6],
                width: (bytes[offset + 7] << 8) | bytes[offset + 8]
            };
        } else if (marker === 0xe1
            && offset + 6 < bytes.length
            && bytes[offset + 4] === 0x45 && bytes[offset + 5] === 0x78
            && bytes[offset + 6] === 0x69 && bytes[offset + 7] === 0x66
        ) {
            hasExif = true;
        } else if (marker === 0xe2 && offset + 13 < bytes.length) {
            const signature = String.fromCharCode(
                bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
                bytes[offset + 8], bytes[offset + 9], bytes[offset + 10], bytes[offset + 11],
                bytes[offset + 12], bytes[offset + 13]
            );
            if (signature === 'ICC_PROFILE') hasIcc = true;
        }
        if (sof) break;
        offset += 2 + length;
    }
    return {
        progressive: Boolean(sof && sof.marker === 0xc2),
        marker: sof ? `0x${sof.marker.toString(16)}` : null,
        width: sof?.width ?? 0,
        height: sof?.height ?? 0,
        hasExif,
        hasIcc,
        byteLength: bytes.length
    };
}

export function describeJpeg(bytes) {
    const info = inspectJpeg(bytes);
    if (!info) return 'not-jpeg';
    const sizeKb = (bytes.length / 1024).toFixed(1);
    return `${info.progressive ? 'PROGRESSIVE' : 'BASELINE'} ${info.width}x${info.height} ${sizeKb}KB exif=${info.hasExif} icc=${info.hasIcc}`;
}
