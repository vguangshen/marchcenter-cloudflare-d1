import { getEnv } from '../config/runtime.js';

const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_TOTAL_BYTES = 20 * 1024 * 1024;
// Multipart framing and text fields on top of the file bytes.
export const MAX_ATTACHMENT_REQUEST_BYTES = MAX_FILES_TOTAL_BYTES + 512 * 1024;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

export function isAttachmentForm(request) {
    return /^multipart\/form-data(?:\s*;|$)/i.test(request.headers.get('content-type') || '');
}

// Like the wallpaper upload, the byte cap is enforced while reading so a
// chunked body without Content-Length cannot be buffered in full first.
export async function readAttachmentForm(request, label) {
    const contentType = request.headers.get('content-type') || '';
    if (!isAttachmentForm(request)) throw httpError(415, `请以表单方式提交${label}`);
    const body = request.body;
    if (!body) throw httpError(400, `${label}表单不能为空`);
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_ATTACHMENT_REQUEST_BYTES) {
                await reader.cancel();
                throw httpError(413, '附件合计不能超过 20MB');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    try {
        return await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: new Blob(chunks) }).formData();
    } catch {
        throw httpError(400, `${label}表单格式无效`);
    }
}

function startsWith(bytes, signature, offset = 0) {
    if (bytes.length < offset + signature.length) return false;
    return signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = text => [...text].map(char => char.charCodeAt(0));
const OFFICE_TYPES = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip'
};
const TEXT_TYPES = { txt: 'text/plain', log: 'text/plain', csv: 'text/csv' };

/**
 * Classifies image and document formats by their signatures and verifies UTF-8
 * for text downloads. SVG and HTML are excluded from inline previews.
 */
function detectAttachmentType(bytes, fileName) {
    const extension = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png', image: true };
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: 'image/jpeg', image: true };
    if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return { type: 'image/gif', image: true };
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { type: 'image/webp', image: true };
    if (startsWith(bytes, ascii('%PDF-'))) return { type: 'application/pdf', image: false };
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && Object.hasOwn(OFFICE_TYPES, extension)) return { type: OFFICE_TYPES[extension], image: false };
    if (Object.hasOwn(TEXT_TYPES, extension) && !bytes.includes(0)) {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return { type: `${TEXT_TYPES[extension]}; charset=utf-8`, image: false };
        } catch {
            return null;
        }
    }
    return null;
}

function cleanFileName(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim();
    if (!base) return 'attachment';
    if (base.length <= 120) return base;
    const extension = base.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || '';
    return `${base.slice(0, 120 - extension.length).toWellFormed()}${extension}`;
}

export async function readAttachments(form) {
    const files = form.getAll('files').filter(file => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    if (files.length > MAX_FILES_PER_MESSAGE) throw httpError(400, `每次最多上传 ${MAX_FILES_PER_MESSAGE} 个附件`);
    let total = 0;
    const output = [];
    for (const file of files) {
        if (file.size > MAX_FILE_BYTES) throw httpError(413, `「${cleanFileName(file.name)}」超过 10MB`);
        total += file.size;
        if (total > MAX_FILES_TOTAL_BYTES) throw httpError(413, '附件合计不能超过 20MB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fileName = cleanFileName(file.name);
        const detected = detectAttachmentType(bytes, fileName);
        if (!detected) throw httpError(415, `「${fileName}」的格式不受支持，请上传图片、PDF、文本、ZIP、Word 或 Excel 文件`);
        output.push({ bytes, fileName, contentType: detected.type, size: bytes.byteLength });
    }
    return output;
}

function attachmentBucket() {
    const bucket = getEnv('TICKET_FILES', null);
    if (!bucket || typeof bucket.put !== 'function') throw httpError(503, '附件存储暂不可用，请稍后再试');
    return bucket;
}

export async function saveWithAttachments(prefix, files, save) {
    if (!files.length) return save([]);
    const bucket = attachmentBucket();
    const uploaded = [];
    try {
        for (const { bytes, ...file } of files) {
            const key = `${prefix}/${crypto.randomUUID()}`;
            uploaded.push({ ...file, key });
            await bucket.put(key, bytes, { httpMetadata: { contentType: file.contentType } });
        }
        return await save(uploaded);
    } catch (error) {
        await Promise.allSettled(uploaded.map(file => bucket.delete(file.key)));
        throw error;
    }
}

export async function streamPrivateAttachment(res, attachment) {
    const object = await attachmentBucket().get(attachment.object_key);
    if (!object) throw httpError(404, '附件文件已丢失');
    const image = String(attachment.content_type).startsWith('image/');
    const encodedName = encodeURIComponent(attachment.file_name.toWellFormed())
        .replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.status(200).stream(object.body, {
        'Content-Type': attachment.content_type,
        'Content-Length': String(attachment.size),
        'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox"
    });
}
