import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MessageCircle, Minus, RefreshCw } from 'lucide-react';
import { api } from '../../utils/api';
import SupportChatThread from './SupportChatThread';
import { useVisibleChatPolling } from './useVisibleChatPolling';

const AUTOMATED_REPLY_PREFIXES = { template: '模板：', ai: 'AI：' };

function StaffInbox({ active, onSelect, page, setPage }) {
    const [queue, setQueue] = useState(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    useVisibleChatPolling(active, async signal => {
        try {
            const result = await api.get(`/support-chat/conversations?scope=all&page=${page}`, { signal, retry: 0, fallback: '读取客服会话失败' });
            if (signal.aborted) return;
            setQueue(result);
            setError('');
            if (page > result.totalPages) setPage(result.totalPages);
        } catch (failure) {
            if (!signal.aborted) setError(failure.message || '读取客服会话失败');
        }
    }, `${page}:${retry}`);
    const pending = queue?.page !== page;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
                    <span className="flex-1">{error}</span>
                    <button type="button" onClick={() => setRetry(value => value + 1)} className="mc-button mc-button--ghost mc-button--compact"><RefreshCw className="h-3.5 w-3.5" />重试</button>
                </div>}
                {pending ? (!error && <div className="flex justify-center p-6" role="status" aria-label="正在读取会话"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>) : queue.conversations.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400"><MessageCircle className="mx-auto mb-3 h-7 w-7" />暂无用户会话</div>
                ) : (
                    <ul className="space-y-1.5" aria-label="用户会话列表">
                        {queue.conversations.map(conversation => (
                            <li key={conversation.id}>
                                <button type="button" data-conversation-id={conversation.id} onClick={() => onSelect(conversation)} className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition hover:border-slate-300/60 hover:bg-white/65 focus-visible:outline-2 focus-visible:outline-[var(--system-accent)] dark:hover:border-slate-600/60 dark:hover:bg-slate-800/65">
                                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-500/10 text-slate-500 dark:text-slate-300"><MessageCircle className="h-4 w-4" /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                                            <span className="min-w-0 truncate">{conversation.ownerUsername}</span>
                                            {conversation.humanRequested &&
                                                <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-300">人工接待</span>}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{conversation.lastAuthorRole === 'staff' ? AUTOMATED_REPLY_PREFIXES[conversation.lastReplySource] || '客服：' : ''}{conversation.lastMessage}</span>
                                    </span>
                                    {conversation.staffUnread > 0 && <span aria-label={`${conversation.staffUnread} 条未读消息`} className="shrink-0 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">{conversation.staffUnread > 99 ? '99+' : conversation.staffUnread}</span>}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {queue?.totalPages > 1 && (
                <div className="flex shrink-0 items-center justify-between border-t border-slate-300/35 px-3 py-2 dark:border-slate-600/40">
                    <button type="button" disabled={pending || page === 1} onClick={() => { setError(''); setPage(page - 1); }} className="mc-button mc-button--ghost mc-button--compact" aria-label="上一页"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{page} / {queue.totalPages}</span>
                    <button type="button" disabled={pending || page >= queue.totalPages} onClick={() => { setError(''); setPage(page + 1); }} className="mc-button mc-button--ghost mc-button--compact" aria-label="下一页"><ChevronRight className="h-4 w-4" /></button>
                </div>
            )}
        </div>
    );
}

export default function SupportChatPanel({ expanded, isStaff, onMinimize, onUnreadChange }) {
    const [staffTab, setStaffTab] = useState('inbox');
    const [staffOwnOpened, setStaffOwnOpened] = useState(false);
    const [selected, setSelected] = useState(null);
    const [page, setPage] = useState(1);
    const [options, setOptions] = useState(null);
    const [optionsError, setOptionsError] = useState('');
    const [optionsRetry, setOptionsRetry] = useState(0);
    const minimizeRef = useRef(null);
    const staffInboxTabRef = useRef(null);
    const inboxRef = useRef(null);
    const backRef = useRef(null);
    const own = !isStaff || staffTab === 'own';
    const staffInbox = isStaff && staffTab === 'inbox';
    const inbox = staffInbox && !selected;

    useEffect(() => {
        if (!expanded || !own) return undefined;
        const controller = new AbortController();
        api.get('/support-chat/options', { signal: controller.signal, retry: 0, fallback: '读取客服设置失败' })
            .then(result => {
                if (controller.signal.aborted) return;
                setOptions(result);
                setOptionsError('');
            })
            .catch(failure => {
                if (!controller.signal.aborted) setOptionsError(failure.message || '读取客服设置失败');
            });
        return () => controller.abort();
    }, [expanded, own, optionsRetry]);

    const selectConversation = conversation => {
        setSelected(conversation);
        window.requestAnimationFrame(() => backRef.current?.focus({ preventScroll: true }));
    };

    const showInbox = () => {
        const id = selected.id;
        setSelected(null);
        window.requestAnimationFrame(() => {
            const row = inboxRef.current?.querySelector(`[data-conversation-id="${id}"]`);
            (row || staffInboxTabRef.current)?.focus({ preventScroll: true });
        });
    };

    useEffect(() => {
        if (!expanded) return undefined;
        const frame = window.requestAnimationFrame(() => minimizeRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [expanded]);

    return (
        <section id="support-chat-panel" role="region" aria-labelledby="support-chat-heading" hidden={!expanded}
            className="flex min-h-0 flex-col overflow-hidden"
            onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onMinimize(); } }}>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-300/35 px-4 py-3 dark:border-slate-600/40">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[rgb(var(--system-accent-rgb)/.14)] text-[rgb(var(--system-accent-rgb))]"><MessageCircle className="h-4 w-4" /></span>
                    <h2 id="support-chat-heading" className="text-base font-black text-slate-900 dark:text-slate-100">客服</h2>
                </div>
                <button ref={minimizeRef} type="button" onClick={onMinimize} aria-label="收起客服" className="mc-button mc-button--ghost mc-button--compact"><Minus className="h-4 w-4" /></button>
            </header>
            {isStaff && (
                <div role="group" aria-label="客服视图" className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-300/35 px-3 py-2 dark:border-slate-600/40">
                    <button ref={staffInboxTabRef} type="button" aria-pressed={staffInbox} onClick={() => setStaffTab('inbox')} className={`mc-button mc-button--compact ${staffInbox ? 'mc-button--secondary' : 'mc-button--ghost'}`}>用户会话</button>
                    <button type="button" aria-pressed={own} onClick={() => { setStaffTab('own'); setStaffOwnOpened(true); }} className={`mc-button mc-button--compact ${own ? 'mc-button--secondary' : 'mc-button--ghost'}`}>我的客服</button>
                </div>
            )}
            {isStaff && (
                <div ref={inboxRef} className={inbox ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                    <StaffInbox active={expanded && inbox} page={page} setPage={setPage} onSelect={selectConversation} />
                </div>
            )}
            {(!isStaff || staffOwnOpened) && (
                <div className={own ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                    {optionsError && (
                        <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                            <span className="min-w-0 flex-1">{optionsError}</span>
                            <button type="button" onClick={() => { setOptionsError(''); setOptionsRetry(value => value + 1); }}
                                className="mc-button mc-button--ghost mc-button--compact">重试</button>
                        </div>
                    )}
                    <SupportChatThread active={expanded && own} own onUnreadChange={onUnreadChange}
                        optionsPending={!options && !optionsError} quickQuestions={options?.templates} aiActive={Boolean(options?.aiEnabled && options?.aiConfigured)} />
                </div>
            )}
            {isStaff && selected && (
                <div className={staffInbox ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
                    <div className="flex shrink-0 items-center gap-2 border-b border-slate-300/35 px-3 py-2 dark:border-slate-600/40">
                        <button ref={backRef} type="button" onClick={showInbox} className="mc-button mc-button--ghost mc-button--compact" aria-label="返回会话列表"><ChevronLeft className="h-4 w-4" /></button>
                        <h3 className="min-w-0 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{selected.ownerUsername}</h3>
                    </div>
                    <SupportChatThread key={selected.id} active={expanded && staffInbox} initialConversation={selected} onUnreadChange={onUnreadChange} />
                </div>
            )}
        </section>
    );
}
