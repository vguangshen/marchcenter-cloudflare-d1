// 检查工具：确认 JPEG 文件确实是 Progressive（SOF2）而非 baseline（SOF0）。
// 用法：
//   node scripts/check-jpeg-progressive.mjs <file...|url...>
// 示例：
//   node scripts/check-jpeg-progressive.mjs dist/out.jpg https://marchcenter.top/api/wallpapers/9/content?v=...
// 任一输入不是 progressive JPEG 时退出码为 1。
import { readFile } from 'node:fs/promises';
import { inspectJpeg } from './jpeg-utils.mjs';

async function load(target) {
    if (/^https?:\/\//i.test(target)) {
        const response = await fetch(target, { headers: { 'User-Agent': 'MarchCenter-Wallpaper-Engine/1.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    return new Uint8Array(await readFile(target));
}

const targets = process.argv.slice(2);
if (!targets.length) {
    console.error('用法: node scripts/check-jpeg-progressive.mjs <file|url> ...');
    process.exit(2);
}

let allProgressive = true;
for (const target of targets) {
    try {
        const bytes = await load(target);
        const info = inspectJpeg(bytes);
        if (!info) {
            console.log(`${target.padEnd(60)} NOT-JPEG`);
            allProgressive = false;
        } else if (info.progressive) {
            console.log(`${target.padEnd(60)} PROGRESSIVE ${info.width}x${info.height} ${(info.byteLength / 1024).toFixed(1)}KB exif=${info.hasExif} icc=${info.hasIcc}`);
        } else {
            console.log(`${target.padEnd(60)} BASELINE   ${info.width}x${info.height} ${(info.byteLength / 1024).toFixed(1)}KB exif=${info.hasExif} icc=${info.hasIcc}  <-- 不是 progressive`);
            allProgressive = false;
        }
    } catch (error) {
        console.log(`${target.padEnd(60)} ERROR: ${error.message}`);
        allProgressive = false;
    }
}

process.exit(allProgressive ? 0 : 1);
