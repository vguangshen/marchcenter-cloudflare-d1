// 本地壁纸优化管线：把壁纸内容一次性重编码为 Progressive JPEG。
//
// 自动 Bing 同步已在 Worker 内用 MozJPEG WASM 直接输出 progressive JPEG；
// 本脚本保留给手动补跑/批量升级，因为原生 sharp 还能 resize 与自适应质量：
//   - Worker 无法运行原生 sharp（native binding 不在 Workers 运行时）；
//   - 本脚本用 Node 原生 sharp（含 mozjpeg），把已有壁纸通过
//     POST /api/wallpapers/:id/replace 写回（内容寻址，版本化 URL 自动
//     切换缓存），不经过任何 Worker 请求路径转码。
//
// 处理参数（对齐需求）：
//   1920×1080 cover centre；质量从 78 自适应下调至 ≤ --max-size-kb
//   （默认 600KB，需求目标 200-600KB）；progressive + mozjpeg；
//   剥离 EXIF/ICC（sharp 默认不写元数据）；处理后自校验必须是
//   progressive JPEG 才允许写回。
//
// 用法：
//   node scripts/optimize-wallpapers.mjs --origin https://marchcenter.top --all
//   node scripts/optimize-wallpapers.mjs --origin https://marchcenter.top --id 9
//   node scripts/optimize-wallpapers.mjs --origin ... --id 9 --dry-run   # 只处理不写回
//   node scripts/optimize-wallpapers.mjs --dir ./tmp --dry-run          # 本地文件演练
//
// 管理员凭证：--admin-user/--admin-password 或环境变量
// MC_ADMIN_USER / MC_ADMIN_PASSWORD（生产环境不要写进命令行历史）。
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { inspectJpeg, describeJpeg } from './jpeg-utils.mjs';

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const DEFAULT_QUALITY = 78;
const DEFAULT_MAX_KB = 600;

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (key.startsWith('--')) {
            const value = argv[index + 1];
            args[key.slice(2)] = value && !value.startsWith('--') ? value : true;
        }
    }
    return args;
}

async function login(origin, username, password) {
    const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
        throw new Error(`登录失败 (${response.status})：请检查 MC_ADMIN_USER/MC_ADMIN_PASSWORD`);
    }
    const payload = await response.json();
    if (!payload.token) throw new Error('登录响应缺少 token');
    return payload.token;
}

async function listWallpapers(origin, token) {
    const response = await fetch(`${origin}/api/wallpapers`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`壁纸列表失败 (${response.status})`);
    return (await response.json()).wallpapers || [];
}

async function downloadContent(origin, wallpaper) {
    const url = `${origin}/api/wallpapers/${wallpaper.id}/content?v=${wallpaper.content_hash}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败 (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
}

async function processWithSharp(bytes, { quality = DEFAULT_QUALITY, maxKb = DEFAULT_MAX_KB } = {}) {
    // 自适应质量：从建议区间上限开始，逐步下调直到命中目标大小上限；
    // 任何一档都必须产出 progressive JPEG 才接受。
    const qualitySteps = [quality, 75, 72, 70, 65, 60].filter((value, index, list) => list.indexOf(value) === index);
    let last = null;
    for (const step of qualitySteps) {
        const output = await sharp(bytes, { failOn: 'none' })
            .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: step, progressive: true, mozjpeg: true })
            .toBuffer();
        const info = inspectJpeg(new Uint8Array(output));
        if (!info?.progressive) {
            throw new Error('编码结果不是 progressive JPEG，已拒绝写回');
        }
        last = new Uint8Array(output);
        if (output.length / 1024 <= maxKb) break;
    }
    return last;
}

async function replaceContent(origin, token, id, bytes, contentType) {
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: contentType }), 'optimized.jpg');
    const response = await fetch(`${origin}/api/wallpapers/${id}/replace`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`替换失败 (${response.status}): ${text.slice(0, 200)}`);
    }
    return (await response.json()).wallpaper;
}

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const quality = Number(args.quality) || DEFAULT_QUALITY;
const maxKb = Number(args['max-size-kb']) || DEFAULT_MAX_KB;
const origin = String(args.origin || '').replace(/\/+$/, '');

let targets = [];
let token = null;
if (args.dir) {
    const files = await readdir(args.dir);
    targets = files
        .filter((file) => /\.(jpg|jpeg|png|webp|avif)$/i.test(file))
        .map((file) => ({ id: null, title: file, localPath: path.join(args.dir, file) }));
} else {
    if (!/^https?:\/\//.test(origin)) throw new Error('请提供 --origin（如 https://marchcenter.top）');
    const username = args['admin-user'] || process.env.MC_ADMIN_USER;
    const password = args['admin-password'] || process.env.MC_ADMIN_PASSWORD;
    if (!username || !password) throw new Error('需要管理员凭证（--admin-user/--admin-password 或 MC_ADMIN_USER/MC_ADMIN_PASSWORD）');
    token = await login(origin, username, password);
    const wallpapers = await listWallpapers(origin, token);
    if (args.id) {
        const ids = String(args.id).split(',').map((value) => Number(value.trim())).filter(Boolean);
        targets = wallpapers.filter((item) => ids.includes(Number(item.id)));
    } else if (args.all) {
        targets = wallpapers;
    } else {
        throw new Error('请指定 --all 或 --id <id[,id...]>');
    }
}

if (!targets.length) {
    console.log('没有需要处理的壁纸');
    process.exit(0);
}

console.log(`目标：${targets.length} 张 | 质量 ${quality} | 上限 ${maxKb}KB | ${dryRun ? 'DRY-RUN（不写回）' : '写回生产'}`);
console.log('id'.padEnd(5), '|', '处理前'.padEnd(46), '|', '处理后'.padEnd(46), '|', '节省');
for (const target of targets) {
    try {
        let bytes;
        if (target.localPath) {
            bytes = new Uint8Array(await readFile(target.localPath));
        } else {
            bytes = await downloadContent(origin, target);
        }
        const before = inspectJpeg(bytes);
        const beforeText = describeJpeg(bytes);
        const beforeKb = bytes.length / 1024;

        const processed = await processWithSharp(bytes);
        const processedKb = processed.length / 1024;
        if (processedKb > maxKb) {
            console.log(String(target.id ?? '-').padEnd(5), '|', beforeText.padEnd(46), '|',
                `SKIP ${processedKb.toFixed(0)}KB 超出 ${maxKb}KB 上限`.padEnd(46));
            continue;
        }
        if (before?.progressive && processedKb >= beforeKb) {
            console.log(String(target.id ?? '-').padEnd(5), '|', beforeText.padEnd(46), '|',
                `SKIP 已是 progressive 且未变小`.padEnd(46));
            continue;
        }

        let uploaded = null;
        if (!dryRun) {
            if (target.localPath) {
                console.log('--dir 模式仅支持 dry-run，跳过写回');
            } else {
                uploaded = await replaceContent(origin, token, target.id, processed, 'image/jpeg');
            }
        }
        const savedPct = beforeKb > 0 ? (((beforeKb - processedKb) / beforeKb) * 100).toFixed(1) : '-';
        console.log(String(target.id ?? '-').padEnd(5), '|', beforeText.padEnd(46), '|',
            `${describeJpeg(processed)}${uploaded ? ` new_hash=${uploaded.content_hash.slice(0, 12)}` : (dryRun ? ' (dry-run)' : '')}`.padEnd(46),
            '|', `${savedPct}%`);
    } catch (error) {
        console.log(String(target.id ?? '-').padEnd(5), '|', `ERROR: ${error.message}`);
    }
}
console.log(dryRun
    ? 'DRY-RUN 完成：未写回任何内容'
    : '完成：progressive 内容已通过 /:id/replace 写回（版本化 URL 自动切换）');
