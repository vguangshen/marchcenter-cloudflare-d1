import React, { useEffect, useRef, useState } from 'react';
import { Download, FileArchive, FileText, ImagePlus, Loader2, Paperclip, X } from 'lucide-react';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { ACCEPT_ATTACHMENTS, MAX_FILES, formatBytes } from './ticketShared';

const FileGlyph = ({ name, className }) => (/\.(zip|docx|xlsx)$/i.test(name) ? <FileArchive className={className} /> : <FileText className={className} />);

/** Thumbnails of files waiting to be sent. */
export function DraftFileList({ files, onRemove, disabled, className = 'mt-3' }) {
    if (!files.length) return null;
    return (
        <ul className={`ticket-draft-files ${className}`} aria-label="待上传的附件">
            {files.map(item => (
                <li key={item.key} className="ticket-draft-file">
                    {item.previewUrl
                        ? <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                        : <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-slate-500 dark:text-slate-400"><FileGlyph name={item.file.name} className="h-5 w-5" /><span className="w-full truncate text-center text-[10px] font-bold">{item.file.name}</span></span>}
                    <span className="ticket-draft-file__size">{formatBytes(item.file.size)}</span>
                    <button type="button" onClick={() => onRemove(item.key)} disabled={disabled} aria-label={`移除 ${item.file.name}`} className="ticket-draft-file__remove"><X className="h-3 w-3" /></button>
                </li>
            ))}
        </ul>
    );
}

/** The drop zone (or, compact, a paperclip button) that adds attachments. */
export function DraftAttachments({ files, onAdd, onRemove, disabled, compact = false }) {
    const inputRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    const pick = event => {
        const picked = [...(event.currentTarget.files || [])];
        event.currentTarget.value = '';
        if (picked.length) onAdd(picked);
    };
    const drop = event => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        const dropped = [...(event.dataTransfer?.files || [])];
        if (dropped.length) onAdd(dropped);
    };
    const input = <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTACHMENTS} className="hidden" onChange={pick} />;

    if (compact) {
        return (
            <>
                {input}
                <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || files.length >= MAX_FILES} className="ticket-icon-button" title="添加附件（也可以直接粘贴截图）" aria-label="添加附件">
                    <Paperclip className="h-4 w-4" />
                    {files.length > 0 && <span className="ticket-icon-button__count">{files.length}</span>}
                </button>
            </>
        );
    }
    return (
        <div>
            {input}
            <div
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && inputRef.current?.click()}
                onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !disabled) { event.preventDefault(); inputRef.current?.click(); } }}
                onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
                aria-disabled={disabled}
                className={`ticket-dropzone ${dragging ? 'is-dragging' : ''}`}
            >
                <ImagePlus className="h-5 w-5 shrink-0" />
                <span className="min-w-0">
                    <span className="block text-xs font-black text-slate-700 dark:text-slate-200">点击选择、拖入文件，或直接 Ctrl+V 粘贴截图</span>
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-400">最多 {MAX_FILES} 个，单个 ≤10MB · 图片、PDF、TXT/LOG/CSV、ZIP、Word、Excel</span>
                </span>
            </div>
            <DraftFileList files={files} onRemove={onRemove} disabled={disabled} />
        </div>
    );
}

// Signed-in fetches cannot go through <img src>, so attachments are loaded as
// blobs. Recently viewed ones stay cached while the page is open.
const blobCache = new Map();
const MAX_CACHED = 40;

async function loadAttachment(url) {
    if (blobCache.has(url)) return blobCache.get(url);
    const promise = api.blob(url, { fallback: '附件读取失败', timeoutMs: 60_000 })
        .then(({ blob }) => URL.createObjectURL(blob));
    blobCache.set(url, promise);
    promise.catch(() => blobCache.delete(url));
    if (blobCache.size > MAX_CACHED) {
        const [oldest] = blobCache.keys();
        blobCache.get(oldest)?.then(objectUrl => URL.revokeObjectURL(objectUrl)).catch(() => {});
        blobCache.delete(oldest);
    }
    return promise;
}

function ImageAttachment({ url, attachment, onOpen }) {
    const [src, setSrc] = useState('');
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        loadAttachment(url).then(objectUrl => { if (active) setSrc(objectUrl); }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [url]);
    return (
        <button type="button" onClick={() => src && onOpen({ src, name: attachment.fileName })} className="ticket-image-attachment" aria-label={`查看图片 ${attachment.fileName}`} disabled={!src}>
            {src ? <img src={src} alt={attachment.fileName} className="h-full w-full object-cover" />
                : <span className="flex h-full w-full items-center justify-center text-slate-400">{failed ? <span className="px-2 text-[10px] font-bold">图片读取失败</span> : <Loader2 className="h-4 w-4 animate-spin" />}</span>}
        </button>
    );
}

function FileAttachment({ url, attachment }) {
    const [busy, setBusy] = useState(false);
    const download = async () => {
        setBusy(true);
        try {
            const objectUrl = await loadAttachment(url);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = attachment.fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            notify(error.message || '附件下载失败', 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <button type="button" onClick={download} disabled={busy} className="ticket-file-attachment" title={`下载 ${attachment.fileName}`}>
            <FileGlyph name={attachment.fileName} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{attachment.fileName}</span>
            <span className="shrink-0 text-[10px] font-medium opacity-70">{formatBytes(attachment.size)}</span>
            {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0" />}
        </button>
    );
}

export function MessageAttachments({ ticketId, attachments, onOpenImage }) {
    if (!attachments.length) return null;
    const images = attachments.filter(item => item.contentType.startsWith('image/'));
    const files = attachments.filter(item => !item.contentType.startsWith('image/'));
    const urlFor = item => `/tickets/${ticketId}/attachments/${item.id}`;
    return (
        <div className="mt-2 space-y-2">
            {images.length > 0 && <div className="flex flex-wrap gap-2">{images.map(item => <ImageAttachment key={item.id} url={urlFor(item)} attachment={item} onOpen={onOpenImage} />)}</div>}
            {files.length > 0 && <div className="grid gap-1.5">{files.map(item => <FileAttachment key={item.id} url={urlFor(item)} attachment={item} />)}</div>}
        </div>
    );
}
