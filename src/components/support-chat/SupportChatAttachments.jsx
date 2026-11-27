import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Image, Loader2, Paperclip, X } from 'lucide-react';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { ACCEPT_ATTACHMENTS, MAX_FILES, formatBytes } from '../tickets/ticketShared';

export function ChatAttachmentPicker({ disabled, count, onAdd }) {
    const inputRef = useRef(null);
    return (
        <>
            <input ref={inputRef} type="file" accept={ACCEPT_ATTACHMENTS} multiple hidden disabled={disabled}
                onChange={event => {
                    const picked = Array.from(event.currentTarget.files);
                    event.currentTarget.value = '';
                    if (picked.length) onAdd(picked);
                }} />
            <button type="button" disabled={disabled || count >= MAX_FILES} onClick={() => inputRef.current?.click()}
                aria-label="添加附件" title="添加附件或粘贴截图（最多 5 个，单个 10 MB，合计 20 MB）"
                className="mc-icon-button h-9 w-9 min-w-9 shrink-0">
                <Paperclip className="h-4 w-4" aria-hidden="true" />
            </button>
        </>
    );
}

export function ChatDraftAttachments({ items, disabled, onRemove }) {
    if (!items.length) return null;
    return (
        <ul className="custom-scrollbar mb-2 flex gap-1.5 overflow-x-auto pb-1" aria-label="待上传附件">
            {items.map(({ key, file, previewUrl }) => (
                <li key={key} className="flex max-w-[10rem] shrink-0 items-center gap-1.5 rounded-lg bg-slate-500/10 py-1 pl-1 pr-1.5 text-xs text-slate-700 dark:text-slate-200">
                    {previewUrl
                        ? <img src={previewUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                        : <FileText className="ml-1 h-4 w-4 shrink-0" />}
                    <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
                    <button type="button" onClick={() => onRemove(key)} disabled={disabled} aria-label={`移除 ${file.name}`}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-slate-500/20 disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
                </li>
            ))}
        </ul>
    );
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fetchAttachment(conversationId, attachmentId, signal) {
    return api.blob(`/support-chat/conversations/${conversationId}/attachments/${attachmentId}`, {
        signal, retry: 0, timeoutMs: 60_000, fallback: '读取客服附件失败'
    });
}

function ChatDownload({ conversationId, attachment }) {
    const requestRef = useRef(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => () => requestRef.current?.abort(), []);

    const download = async () => {
        if (loading) return;
        const controller = new AbortController();
        requestRef.current = controller;
        const { signal } = controller;
        setLoading(true);
        try {
            const { blob } = await fetchAttachment(conversationId, attachment.id, signal);
            if (!signal.aborted) downloadBlob(blob, attachment.fileName);
        } catch (error) {
            if (!signal.aborted) notify(error.message || '下载附件失败', 'error');
        } finally {
            if (!signal.aborted) setLoading(false);
        }
    };

    return (
        <button type="button" onClick={download} disabled={loading} aria-label={`下载 ${attachment.fileName}`} title={attachment.fileName}
            className="flex w-full min-w-0 items-center gap-2 rounded-lg bg-slate-500/10 px-2 py-2 text-left text-xs hover:bg-slate-500/20">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
            <span className="shrink-0 text-[10px] opacity-70">{formatBytes(attachment.size)}</span>
            {loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="h-3.5 w-3.5 shrink-0" />}
        </button>
    );
}

function ChatImage({ conversationId, attachment, onPreview }) {
    const buttonRef = useRef(null);
    const [visible, setVisible] = useState(false);
    const [image, setImage] = useState(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '96px' });
        observer.observe(buttonRef.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible) {
            setImage(null);
            return undefined;
        }
        const controller = new AbortController();
        const { signal } = controller;
        let url;
        setFailed(false);
        fetchAttachment(conversationId, attachment.id, signal).then(({ blob }) => {
            if (signal.aborted) return;
            url = URL.createObjectURL(blob);
            setImage({ blob, url });
        }).catch(() => { if (!signal.aborted) setFailed(true); });
        return () => {
            controller.abort();
            if (url) URL.revokeObjectURL(url);
        };
    }, [visible, conversationId, attachment.id, attempt]);

    return (
        <button ref={buttonRef} type="button" disabled={!image && !failed}
            onClick={event => {
                if (image) onPreview({ blob: image.blob, name: attachment.fileName, trigger: event.currentTarget });
                else if (failed) setAttempt(value => value + 1);
            }}
            aria-label={`${failed ? '重新读取图片' : '查看图片'} ${attachment.fileName}`}
            className="h-20 w-28 max-w-full overflow-hidden rounded-lg bg-slate-500/10 hover:bg-slate-500/20">
            {image
                ? <img src={image.url} alt={attachment.fileName} className="h-full w-full object-cover" />
                : <span className="grid h-full place-items-center px-2 text-[10px] text-slate-500 dark:text-slate-400">
                    {failed ? '图片加载失败，点击重试' : visible ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
                </span>}
        </button>
    );
}

export function ChatMessageAttachments({ conversationId, attachments, onPreview }) {
    return (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="消息附件">
            {attachments.map(attachment => (
                attachment.contentType.startsWith('image/')
                    ? <li key={attachment.id} className="max-w-full"><ChatImage conversationId={conversationId} attachment={attachment} onPreview={onPreview} /></li>
                    : <li key={attachment.id} className="w-full min-w-0"><ChatDownload conversationId={conversationId} attachment={attachment} /></li>
            ))}
        </ul>
    );
}

export function ChatImagePreview({ preview, onClose }) {
    const [url, setUrl] = useState('');
    const closeRef = useRef(null);
    useEffect(() => {
        const objectUrl = URL.createObjectURL(preview.blob);
        setUrl(objectUrl);
        closeRef.current?.focus({ preventScroll: true });
        return () => URL.revokeObjectURL(objectUrl);
    }, [preview]);

    return (
        <div role="region" aria-label="图片预览" className="flex min-h-0 flex-1 flex-col bg-slate-500/10"
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }}>
            <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700 dark:text-slate-200" title={preview.name}>{preview.name}</p>
                <button type="button" aria-label={`下载 ${preview.name}`} onClick={() => downloadBlob(preview.blob, preview.name)} className="mc-button mc-button--ghost mc-button--compact"><Download className="h-4 w-4" /></button>
                <button ref={closeRef} type="button" aria-label="关闭图片预览" onClick={onClose} className="mc-button mc-button--ghost mc-button--compact"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid min-h-0 flex-1 place-items-center overflow-hidden p-3">
                {url && <img src={url} alt={preview.name} className="max-h-full max-w-full rounded-lg object-contain" />}
            </div>
        </div>
    );
}
