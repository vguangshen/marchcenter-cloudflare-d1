import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { api } from '../../utils/api';
import { mergeDraftFiles, releaseDraftFiles, UPLOAD_TIMEOUT_MS } from '../tickets/ticketShared';
import { ChatAttachmentPicker, ChatDraftAttachments, ChatImagePreview, ChatMessageAttachments } from './SupportChatAttachments';
import { useVisibleChatPolling } from './useVisibleChatPolling';

const MAX_BODY_LENGTH = 2000;
const timeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function mergeMessages(first, second) {
    if (!second.length || (first.length >= second.length &&
        second.every((message, index) => first[first.length - second.length + index].id === message.id))) return first;
    const messages = new Map(first.map(message => [message.id, message]));
    for (const message of second) messages.set(message.id, message);
    return [...messages.values()].sort((left, right) => left.id - right.id);
}

function mergeLatest(timeline, result) {
    const latest = result.messages.at(-1)?.id ?? 0;
    if (latest < timeline.latestServerId) return timeline;
    const gap = timeline.latestServerId && result.hasMore && result.messages[0]?.id > timeline.latestServerId;
    const retained = gap ? timeline.messages.filter(message => message.id > latest) : timeline.messages;
    return {
        messages: mergeMessages(retained, result.messages),
        latestServerId: latest,
        hasMore: timeline.hasHistory && !gap ? timeline.hasMore : result.hasMore,
        hasHistory: timeline.hasHistory && !gap
    };
}

const AUTOMATION_LABELS = { template: '客服自动回复', ai: 'AI 客服' };

function ChatMessage({ conversationId, message, own, onPreview }) {
    const mine = own ? message.authorRole === 'user' : message.authorRole === 'staff';
    const automation = AUTOMATION_LABELS[message.replySource];
    const author = automation || (own
        ? (mine ? '我' : '客服')
        : message.authorRole === 'staff' ? ['客服', message.authorUsername].filter(Boolean).join(' · ') : (message.authorUsername || '用户'));
    const attachments = message.attachments || [];
    return (
        <li className={`flex max-w-[86%] flex-col ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
            <div className="mb-1 flex flex-wrap items-center gap-x-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 font-bold">{automation && <Bot className="h-3.5 w-3.5" aria-hidden="true" />}{author}</span>
                <time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time>
            </div>
            <div className={`max-w-full space-y-2 rounded-2xl px-3 py-2 text-sm leading-relaxed ${mine ? 'rounded-br-md bg-[rgb(var(--system-accent-rgb)/.14)] text-slate-900 dark:text-slate-100' : 'rounded-bl-md bg-slate-500/10 text-slate-800 dark:text-slate-100'}`}>
                {message.body && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.body}</p>}
                {conversationId && attachments.length > 0 && <ChatMessageAttachments conversationId={conversationId} attachments={attachments} onPreview={onPreview} />}
            </div>
        </li>
    );
}

export default function SupportChatThread({
    active, own = false, initialConversation = null, onUnreadChange,
    quickQuestions = [], aiActive = false, optionsPending = false
}) {
    const [conversation, setConversation] = useState(initialConversation);
    const [timeline, setTimeline] = useState({ messages: [], latestServerId: 0, hasMore: false, hasHistory: false });
    const { messages, hasMore } = timeline;
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [historyError, setHistoryError] = useState('');
    const [retry, setRetry] = useState(0);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [body, setBody] = useState('');
    const [pendingAction, setPendingAction] = useState(null);
    const [sendError, setSendError] = useState('');
    const [draftFiles, setDraftFiles] = useState([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [preview, setPreview] = useState(null);
    const aiDisclosureId = useId();
    const draftRef = useRef([]);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const oldestMessageIdRef = useRef(null);
    oldestMessageIdRef.current = messages[0]?.id;
    const newestSeenRef = useRef(0);
    const scrollAdjustmentRef = useRef(null);
    const scrollToBottomRef = useRef(true);
    const actionRequestRef = useRef(null);
    const olderRequestRef = useRef(null);
    const conversationRevision = useRef(0);
    const humanRequested = Boolean(conversation?.humanRequested);
    const busy = pendingAction !== null;
    const waitingForOptions = own && optionsPending && !humanRequested;
    const canAskAi = own && aiActive && !optionsPending && !humanRequested;
    const showQuestions = own && !humanRequested && (!body.trim() || quickQuestions.some(item => item.question === body));

    useEffect(() => () => {
        actionRequestRef.current?.abort();
        olderRequestRef.current?.abort();
        releaseDraftFiles(draftRef.current);
    }, []);
    useEffect(() => {
        if (!active) {
            olderRequestRef.current?.abort();
            setLoadingOlder(false);
        }
    }, [active]);

    useVisibleChatPolling(active, async signal => {
        try {
            const revision = conversationRevision.current;
            let current = conversation;
            if (!current) {
                const result = await api.get('/support-chat/conversations?scope=mine', { signal, retry: 0, fallback: '读取客服会话失败' });
                current = result.conversations[0];
            }
            if (signal.aborted) return;
            if (current) {
                const result = await api.get(`/support-chat/conversations/${current.id}`, { signal, retry: 0, fallback: '读取客服消息失败' });
                if (signal.aborted) return;
                const newest = result.messages.at(-1)?.id ?? 0;
                if (revision === conversationRevision.current) setConversation(result.conversation);
                setTimeline(previous => mergeLatest(previous, result));
                if (newest > newestSeenRef.current) {
                    newestSeenRef.current = newest;
                    onUnreadChange?.();
                }
            }
            setLoaded(true);
            setError('');
        } catch (failure) {
            if (!signal.aborted) setError(failure.message || '读取客服消息失败');
        }
    }, retry);

    useLayoutEffect(() => {
        if (!active) return;
        const list = listRef.current;
        if (!list) return;
        const previous = scrollAdjustmentRef.current;
        if (previous) {
            list.scrollTop = previous.top + list.scrollHeight - previous.height;
            scrollAdjustmentRef.current = null;
        } else if (scrollToBottomRef.current) {
            list.scrollTop = list.scrollHeight;
        }
    }, [active, messages]);

    const loadOlder = async () => {
        if (loadingOlder || !conversation || !messages.length) return;
        const controller = new AbortController();
        olderRequestRef.current = controller;
        const { signal } = controller;
        setLoadingOlder(true);
        setHistoryError('');
        const before = messages[0].id;
        try {
            const result = await api.get(`/support-chat/conversations/${conversation.id}?before=${before}`, { signal, retry: 0, fallback: '读取历史消息失败' });
            if (signal.aborted || oldestMessageIdRef.current !== before) return;
            const list = listRef.current;
            if (list) scrollAdjustmentRef.current = { top: list.scrollTop, height: list.scrollHeight };
            setTimeline(previous => previous.messages[0]?.id === before ? {
                ...previous,
                messages: mergeMessages(previous.messages, result.messages),
                hasMore: result.hasMore,
                hasHistory: true
            } : previous);
        } catch (failure) {
            if (!signal.aborted) setHistoryError(failure.message || '读取历史消息失败');
        } finally {
            if (!signal.aborted) setLoadingOlder(false);
        }
    };

    const send = async event => {
        event.preventDefault();
        const text = body.trim();
        if ((!text && !draftRef.current.length) || busy || waitingForOptions) return;
        const controller = new AbortController();
        actionRequestRef.current = controller;
        const { signal } = controller;
        setSendError('');
        setPendingAction('send');
        try {
            const path = own ? '/support-chat/messages' : `/support-chat/conversations/${conversation.id}/messages`;
            let payload = { body: text, allowAi: canAskAi && Boolean(text) };
            if (draftRef.current.length) {
                payload = new FormData();
                payload.append('body', text);
                for (const { file } of draftRef.current) payload.append('files', file, file.name);
            }
            const result = await api.post(path, payload, {
                signal, retry: 0, fallback: '发送消息失败',
                ...(payload instanceof FormData ? { timeoutMs: UPLOAD_TIMEOUT_MS } : {})
            });
            if (signal.aborted) return;
            applyResult(result);
            setBody('');
            releaseDraftFiles(draftRef.current);
            draftRef.current = [];
            setDraftFiles([]);
            setAttachmentError('');
        } catch (failure) {
            if (!signal.aborted) setSendError(failure.message || '发送消息失败');
        } finally {
            if (!signal.aborted) setPendingAction(null);
        }
    };

    function applyResult(result) {
        conversationRevision.current += 1;
        if (result.conversation) setConversation(result.conversation);
        if (result.message) {
            scrollToBottomRef.current = true;
            setTimeline(previous => ({ ...previous, messages: mergeMessages(previous.messages, [result.message]) }));
        }
        setLoaded(true);
        onUnreadChange?.();
    }

    const finishHandoff = async () => {
        if (busy || own || !humanRequested) return;
        const controller = new AbortController();
        actionRequestRef.current = controller;
        const { signal } = controller;
        setSendError('');
        setPendingAction('finish');
        try {
            const result = await api.post(`/support-chat/conversations/${conversation.id}/finish-handoff`, {}, {
                signal, retry: 0, fallback: '结束接待失败'
            });
            if (!signal.aborted) applyResult(result);
        } catch (failure) {
            if (!signal.aborted) setSendError(failure.message || '结束接待失败');
        } finally {
            if (!signal.aborted) setPendingAction(null);
        }
    };

    const addFiles = files => {
        if (busy) return;
        const { files: next, problem } = mergeDraftFiles(draftRef.current, files);
        draftRef.current = next;
        setDraftFiles(next);
        setAttachmentError(problem);
    };

    const removeFile = key => {
        const item = draftRef.current.find(file => file.key === key);
        if (!item) return;
        releaseDraftFiles([item]);
        const next = draftRef.current.filter(file => file.key !== key);
        draftRef.current = next;
        setDraftFiles(next);
        setAttachmentError('');
    };

    const closePreview = () => {
        const trigger = preview?.trigger;
        setPreview(null);
        window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };

    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div inert={Boolean(preview)} className="flex min-h-0 flex-1 flex-col">
                {humanRequested && (
                    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-300/35 bg-amber-500/10 px-4 py-1.5 text-xs text-slate-700 dark:border-slate-600/40 dark:text-slate-200">
                        <p role="status">人工接待中</p>
                        {!own && <button type="button" onClick={finishHandoff} disabled={busy} className="mc-button mc-button--ghost mc-button--compact !min-h-8">
                            {pendingAction === 'finish' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}结束接待
                        </button>}
                    </div>
                )}
                <div ref={listRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
                    onScroll={event => {
                        const list = event.currentTarget;
                        scrollToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
                    }}>
                    {hasMore && (
                        <div className="mb-3 text-center">
                            <button type="button" onClick={loadOlder} disabled={loadingOlder} className="mc-button mc-button--ghost mc-button--compact">{loadingOlder ? '正在读取…' : '加载更早的消息'}</button>
                        </div>
                    )}
                    {(error || historyError) && (
                        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
                            <span className="flex-1">{error || historyError}</span>
                            <button type="button" onClick={error ? () => setRetry(value => value + 1) : loadOlder} className="mc-button mc-button--ghost mc-button--compact"><RefreshCw className="h-3.5 w-3.5" />重试</button>
                        </div>
                    )}
                    {messages.length ? (
                        <ol aria-label="客服消息" className="flex flex-col gap-3">
                            {messages.map(message => <ChatMessage key={message.id} conversationId={conversation?.id} message={message} own={own} onPreview={setPreview} />)}
                        </ol>
                    ) : loaded ? (
                        <div className="px-2 py-9 text-center text-sm text-slate-500 dark:text-slate-400"><MessageCircle className="mx-auto mb-3 h-8 w-8" />{own ? '你好，有什么可以帮你？' : '暂无消息'}</div>
                    ) : !error && <div className="flex justify-center p-6" role="status" aria-label="正在读取客服消息"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>}
                </div>
                <form onSubmit={send}
                    onPaste={event => {
                        const files = Array.from(event.clipboardData?.files || []);
                        if (!files.length) return;
                        event.preventDefault();
                        addFiles(files);
                    }}
                    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
                    onDrop={event => {
                        if (!event.dataTransfer.files.length) return;
                        event.preventDefault();
                        addFiles(Array.from(event.dataTransfer.files));
                    }}
                    className="shrink-0 border-t border-slate-300/35 px-3 py-3 dark:border-slate-600/40">
                    {showQuestions && quickQuestions.length > 0 && (
                        <div role="group" aria-label="常见问题" className="custom-scrollbar mb-2 flex gap-1.5 overflow-x-auto pb-1">
                            {quickQuestions.map(({ id, question }) => (
                                <button key={id} type="button" title={question} disabled={busy}
                                    onClick={() => { setBody(question.slice(0, MAX_BODY_LENGTH)); setSendError(''); inputRef.current?.focus(); }}
                                    className="max-w-[12rem] shrink-0 truncate rounded-lg bg-slate-500/10 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-500/20 dark:text-slate-200">
                                    {question}
                                </button>
                            ))}
                        </div>
                    )}
                    {sendError && <p role="alert" className="mb-2 text-xs font-medium text-red-700 dark:text-red-300">{sendError}</p>}
                    {attachmentError && <p role="alert" className="mb-2 text-xs font-medium text-red-700 dark:text-red-300">{attachmentError}</p>}
                    <ChatDraftAttachments items={draftFiles} disabled={busy} onRemove={removeFile} />
                    {canAskAi && <p id={aiDisclosureId} className="mb-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">纯文字消息可能交由站点配置的 AI 处理。</p>}
                    {waitingForOptions && <p role="status" className="mb-2 text-xs text-slate-600 dark:text-slate-300">正在读取客服设置…</p>}
                    <div className="flex items-end gap-2">
                        <div className="support-chat-input">
                            <textarea ref={inputRef} aria-label="消息内容" aria-describedby={canAskAi ? aiDisclosureId : undefined} aria-keyshortcuts="Control+Enter Meta+Enter"
                                placeholder="输入消息…" value={body} rows={2} maxLength={MAX_BODY_LENGTH} readOnly={busy}
                                onChange={event => { setBody(event.target.value); setSendError(''); }}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey)) send(event);
                                }}
                                className="text-sm" />
                            <ChatAttachmentPicker count={draftFiles.length} onAdd={addFiles} disabled={busy} />
                        </div>
                        <button type="submit" aria-label="发送消息" disabled={busy || waitingForOptions || (!body.trim() && !draftFiles.length)} className="mc-button mc-button--primary mc-button--compact !h-10 shrink-0">
                            {pendingAction === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                    </div>
                </form>
            </div>
            {preview && (
                <div className="absolute inset-0 z-10 flex flex-col bg-slate-50 dark:bg-slate-900">
                    <ChatImagePreview preview={preview} onClose={closePreview} />
                </div>
            )}
        </div>
    );
}
