import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Lock, RefreshCw, RotateCcw, Send, ShieldCheck, X } from 'lucide-react';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { DraftAttachments, DraftFileList, MessageAttachments } from './TicketAttachments';
import {
    CATEGORY_LABELS, MAX_BODY_LENGTH, STATUS_META, UPLOAD_TIMEOUT_MS,
    formatFullTime, formatRelativeTime, mergeDraftFiles, releaseDraftFiles
} from './ticketShared';

export function StatusPill({ status }) {
    const meta = STATUS_META[status] || STATUS_META.open;
    return <span className={`ticket-status ticket-status--${meta.tone}`}>{meta.label}</span>;
}

function ImageLightbox({ image, onClose }) {
    const closeButtonRef = useRef(null);
    useEffect(() => {
        const trigger = document.activeElement;
        closeButtonRef.current?.focus();
        const onKey = event => {
            if (event.key !== 'Escape' && event.key !== 'Tab') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey, true);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            trigger?.focus();
        };
    }, [onClose]);
    return (
        <div className="ticket-lightbox" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
            <img src={image.src} alt={image.name} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" onClick={event => event.stopPropagation()} />
            <button ref={closeButtonRef} type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white backdrop-blur hover:bg-white/25" aria-label="关闭图片"><X className="h-5 w-5" /></button>
        </div>
    );
}

function Message({ message, ticketId, ownerName, viewerIsOwner, onOpenImage }) {
    if (message.authorRole === 'system') {
        return <li className="ticket-message-system"><span>{message.body}</span><time dateTime={message.createdAt}>{formatRelativeTime(message.createdAt)}</time></li>;
    }
    const fromStaff = message.authorRole === 'staff';
    const mine = viewerIsOwner ? !fromStaff : fromStaff;
    const author = fromStaff ? `管理员${message.authorUsername ? ` · ${message.authorUsername}` : ''}` : (viewerIsOwner ? '我' : ownerName);
    return (
        <li className={`ticket-message ${mine ? 'is-mine' : ''}`}>
            <div className="ticket-message__meta">
                {fromStaff && <ShieldCheck className="h-3 w-3" />}
                <span className="font-black">{author}</span>
                <time dateTime={message.createdAt} title={formatFullTime(message.createdAt)}>{formatRelativeTime(message.createdAt)}</time>
            </div>
            <div className="ticket-message__bubble">
                {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                <MessageAttachments ticketId={ticketId} attachments={message.attachments} onOpenImage={onOpenImage} />
            </div>
        </li>
    );
}

const STAFF_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

/** One ticket's conversation, status controls and reply box. */
export default function TicketThread({ ticketId, onLoaded, onBusyChange }) {
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [loading, setLoading] = useState(true);
    const [reply, setReply] = useState('');
    const [files, setFiles] = useState([]);
    const [sending, setSending] = useState(false);
    const [statusBusy, setStatusBusy] = useState('');
    const [image, setImage] = useState(null);
    const listRef = useRef(null);
    const requestRef = useRef(null);
    const filesRef = useRef(files);
    filesRef.current = files;
    const onLoadedRef = useRef(onLoaded);
    onLoadedRef.current = onLoaded;

    useEffect(() => () => releaseDraftFiles(filesRef.current), []);

    const load = useCallback(async ({ changed = false } = {}) => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        const { signal } = controller;
        setLoading(true);
        setLoadError('');
        try {
            const result = await api.get(`/tickets/${ticketId}`, { signal, fallback: '读取工单失败' });
            if (signal.aborted) return;
            setData(result);
            // Opening the ticket marks it read; let the list and badge catch up.
            onLoadedRef.current?.(result, changed);
        } catch (error) {
            if (!signal.aborted) setLoadError(error.message || '读取工单失败');
        } finally {
            if (!signal.aborted) setLoading(false);
        }
    }, [ticketId]);

    useEffect(() => {
        load();
        return () => requestRef.current?.abort();
    }, [load]);

    // Keep the newest message in view whenever the thread grows.
    const messageCount = data?.messages.length || 0;
    useLayoutEffect(() => {
        const list = listRef.current;
        if (list) list.scrollTop = list.scrollHeight;
    }, [messageCount, ticketId]);

    const addFiles = incoming => {
        const { files: merged, problem } = mergeDraftFiles(filesRef.current, incoming);
        setFiles(merged);
        if (problem) notify(problem, 'warning');
    };
    const removeFile = key => setFiles(current => {
        const removed = current.find(item => item.key === key);
        if (removed) releaseDraftFiles([removed]);
        return current.filter(item => item.key !== key);
    });

    const busy = sending || Boolean(statusBusy);
    const closeImage = useCallback(() => setImage(null), []);

    const send = async event => {
        event?.preventDefault();
        if (busy || loading || (!reply.trim() && !files.length)) return;
        setSending(true);
        onBusyChange?.(true);
        const form = new FormData();
        form.append('body', reply.trim());
        for (const item of files) form.append('files', item.file, item.file.name);
        try {
            await api.post(`/tickets/${ticketId}/messages`, form, { fallback: '发送回复失败', timeoutMs: UPLOAD_TIMEOUT_MS, retry: 0 });
            if (requestRef.current?.signal.aborted) return;
            setReply('');
            releaseDraftFiles(filesRef.current);
            setFiles([]);
            await load({ changed: true });
        } catch (error) {
            notify(error.message || '发送回复失败', 'error');
        } finally {
            setSending(false);
            onBusyChange?.(false);
        }
    };

    const changeStatus = async status => {
        if (busy) return;
        setStatusBusy(status);
        onBusyChange?.(true);
        try {
            const result = await api.patch(`/tickets/${ticketId}/status`, { status }, { fallback: '修改工单状态失败' });
            if (requestRef.current?.signal.aborted) return;
            notify(result?.message || '工单状态已更新', 'success');
            await load({ changed: true });
        } catch (error) {
            notify(error.message || '修改工单状态失败', 'error');
        } finally {
            setStatusBusy('');
            onBusyChange?.(false);
        }
    };

    if (!data) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                {loading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : (
                    <>
                        <p className="text-sm font-bold text-red-600 dark:text-red-400">{loadError}</p>
                        <button type="button" onClick={() => load()} className="mc-button mc-button--secondary mc-button--compact"><RefreshCw className="h-3.5 w-3.5" />重试</button>
                    </>
                )}
            </div>
        );
    }

    const { ticket, messages, viewer } = data;
    const closed = ticket.status === 'closed';
    const staffActor = viewer.staff && !viewer.owner;
    const ownerCanReopen = viewer.owner && ['resolved', 'closed'].includes(ticket.status);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="ticket-thread-header">
                <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <StatusPill status={ticket.status} />
                            <span className="text-[11px] font-bold text-slate-400">#{ticket.id}</span>
                        </div>
                        <h3 className="mt-1.5 break-words text-base font-black leading-snug text-slate-900 dark:text-white">{ticket.subject}</h3>
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            <span>{CATEGORY_LABELS[ticket.category] || '其他问题'}</span>
                            <span>{ticket.cardTitle ? `卡片：${ticket.cardTitle}` : '未关联卡片'}</span>
                            {!viewer.owner && <span>提交人：{ticket.ownerUsername}</span>}
                            <span title={formatFullTime(ticket.createdAt)}>提交于 {formatRelativeTime(ticket.createdAt)}</span>
                        </p>
                    </div>
                    <button type="button" onClick={() => load()} disabled={loading || busy} className="ticket-icon-button" title="刷新" aria-label="刷新工单"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
                </div>
                {staffActor ? (
                    <div className="ticket-status-switch" role="radiogroup" aria-label="工单状态">
                        {STAFF_STATUSES.map(status => (
                            <button key={status} type="button" role="radio" aria-checked={ticket.status === status} disabled={busy || loading} onClick={() => ticket.status !== status && changeStatus(status)} className={ticket.status === status ? 'is-active' : ''}>
                                {statusBusy === status && <Loader2 className="h-3 w-3 animate-spin" />}{STATUS_META[status].label}
                            </button>
                        ))}
                    </div>
                ) : viewer.owner && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {ownerCanReopen && <button type="button" disabled={busy || loading} onClick={() => changeStatus('open')} className="mc-button mc-button--secondary mc-button--compact">{statusBusy === 'open' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}问题未解决，重新打开</button>}
                        {!closed && <button type="button" disabled={busy || loading} onClick={() => changeStatus('closed')} className="mc-button mc-button--ghost mc-button--compact">{statusBusy === 'closed' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}关闭工单</button>}
                    </div>
                )}
            </header>

            <ol ref={listRef} className="ticket-messages custom-scrollbar" aria-label="工单对话">
                {messages.map(message => (
                    <Message key={message.id} message={message} ticketId={ticket.id} ownerName={ticket.ownerUsername} viewerIsOwner={viewer.owner} onOpenImage={setImage} />
                ))}
            </ol>
            {loadError && <p role="alert" className="px-5 py-2 text-xs font-bold text-red-600 dark:text-red-400">{loadError}</p>}

            {closed ? (
                <div className="ticket-pane-footer justify-center text-xs font-bold text-slate-400"><Lock className="h-3.5 w-3.5" />工单已关闭{viewer.owner ? '，重新打开后可以继续回复' : ''}</div>
            ) : (
                <form onSubmit={send} onPaste={event => { const pasted = [...(event.clipboardData?.files || [])]; if (!busy && pasted.length) { event.preventDefault(); addFiles(pasted); } }} className="ticket-reply">
                    <DraftFileList files={files} onRemove={removeFile} disabled={busy} className="basis-full" />
                    <textarea
                        value={reply}
                        onChange={event => setReply(event.target.value)}
                        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) send(event); }}
                        maxLength={MAX_BODY_LENGTH}
                        rows={2}
                        disabled={busy}
                        aria-label="回复内容"
                        placeholder={staffActor ? '回复用户…（Ctrl+Enter 发送，可粘贴截图）' : '补充说明或回复管理员…（Ctrl+Enter 发送，可粘贴截图）'}
                        className="mc-input min-h-[2.75rem] flex-1 resize-none !py-2.5 leading-6"
                    />
                    <div className="flex shrink-0 items-end gap-2">
                        <DraftAttachments compact files={files} onAdd={addFiles} onRemove={removeFile} disabled={busy} />
                        <button type="submit" disabled={busy || loading || (!reply.trim() && !files.length)} aria-label="发送回复" className="mc-button mc-button--primary !h-10 !px-4">
                            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="hidden sm:inline">发送</span>
                        </button>
                    </div>
                </form>
            )}
            {image && <ImageLightbox image={image} onClose={closeImage} />}
        </div>
    );
}
