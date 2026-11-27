import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Inbox, LifeBuoy, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import TicketComposer from './TicketComposer';
import TicketThread, { StatusPill } from './TicketThread';
import { CATEGORY_LABELS, formatRelativeTime } from './ticketShared';

const FILTERS = [
    { id: '', label: '全部' },
    { id: 'active', label: '进行中' },
    { id: 'resolved', label: '已解决' },
    { id: 'closed', label: '已关闭' }
];

function TicketListItem({ ticket, selected, staffView, currentUserId, disabled, onSelect }) {
    // An administrator's own ticket is read from the submitter's side.
    const own = String(ticket.userId) === String(currentUserId);
    const unread = staffView && !own ? ticket.staffUnread > 0 && ['open', 'in_progress'].includes(ticket.status) : ticket.userUnread > 0;
    return (
        <li>
            <button type="button" disabled={disabled} data-ticket-id={ticket.id} onClick={() => onSelect(ticket.id)} aria-current={selected ? 'true' : undefined} className={`ticket-list-item ${selected ? 'is-selected' : ''}`}>
                <span className="flex items-center gap-2">
                    <StatusPill status={ticket.status} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-slate-400">#{ticket.id} · {CATEGORY_LABELS[ticket.category] || '其他问题'}</span>
                    {unread && <span className="ticket-unread-dot" aria-label="有新消息" />}
                </span>
                <span className={`mt-1.5 block truncate text-sm ${unread ? 'font-black text-slate-900 dark:text-white' : 'font-bold text-slate-700 dark:text-slate-200'}`}>{ticket.subject}</span>
                <span className="mt-1 block truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {ticket.lastAuthorRole === 'staff' ? '管理员：' : ticket.lastAuthorRole === 'system' ? '' : staffView ? `${ticket.ownerUsername}：` : ''}{ticket.lastMessage || '（附件）'}
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-[10px] font-medium text-slate-400">
                    <span className="min-w-0 flex-1 truncate">{ticket.cardTitle || '未关联卡片'}{staffView ? ` · ${ticket.ownerUsername}` : ''}</span>
                    <time dateTime={ticket.updatedAt}>{formatRelativeTime(ticket.updatedAt)}</time>
                </span>
            </button>
        </li>
    );
}

/**
 * The ticket workspace: list on the left, the selected ticket or the new
 * ticket form on the right (one pane at a time on phones). Administrators get
 * an extra "全部工单" scope for everyone's tickets.
 */
export default function TicketCenter({ isOpen, onClose, isStaff, currentUserId, cards, onUnreadChange }) {
    const [closing, setClosing] = useState(false);
    const [scope, setScope] = useState(isStaff ? 'all' : 'mine');
    const [filter, setFilter] = useState('');
    const [list, setList] = useState({ tickets: [], page: 1, totalPages: 1, loading: true, error: '' });
    const [view, setView] = useState({ mode: 'empty' });
    const [composeStarted, setComposeStarted] = useState(false);
    const [busy, setBusy] = useState(false);
    const requestRef = useRef(null);
    const sidebarRef = useRef(null);
    const paneRef = useRef(null);
    const closeButtonRef = useRef(null);

    const openComposer = useCallback(() => {
        setComposeStarted(true);
        setView({ mode: 'compose' });
    }, []);

    const returnToList = () => {
        setView({ mode: 'empty' });
        window.requestAnimationFrame(() => {
            const sidebar = sidebarRef.current;
            (sidebar?.querySelector(`[data-ticket-id="${view.id}"]`) || sidebar?.querySelector('button:not([disabled])'))?.focus();
        });
    };

    const requestClose = useCallback(() => {
        if (busy) return;
        setClosing(true);
    }, [busy]);
    const dialogRef = useModalAccessibility(isOpen && !closing, requestClose, { initialFocusRef: closeButtonRef });

    const loadList = useCallback(async ({ page = 1, append = false, reset = false } = {}) => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setList(current => ({
            ...(reset ? { tickets: [], page: 1, totalPages: 1 } : current), loading: true, error: ''
        }));
        try {
            const query = new URLSearchParams({ scope, page: String(page) });
            if (filter) query.set('status', filter);
            const result = await api.get(`/tickets?${query}`, { signal: controller.signal, fallback: '读取工单失败' });
            if (controller.signal.aborted) return;
            setList(current => ({
                tickets: append ? [...current.tickets, ...result.tickets.filter(item => !current.tickets.some(old => old.id === item.id))] : result.tickets,
                page: result.page,
                totalPages: result.totalPages,
                loading: false,
                error: ''
            }));
        } catch (error) {
            if (!controller.signal.aborted) setList(current => ({ ...current, loading: false, error: error.message || '读取工单失败' }));
        }
    }, [scope, filter]);

    useEffect(() => {
        if (!isOpen) return undefined;
        loadList({ reset: true });
        return () => requestRef.current?.abort();
    }, [isOpen, loadList]);

    useEffect(() => {
        if (!isOpen || view.mode === 'empty') return undefined;
        const frame = window.requestAnimationFrame(() => paneRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [isOpen, view]);

    // A user without tickets lands straight on the form.
    const autoComposed = useRef(false);
    useEffect(() => {
        if (autoComposed.current || list.loading || list.error) return;
        autoComposed.current = true;
        if (!composeStarted && !isStaff && scope === 'mine' && !filter && !list.tickets.length) openComposer();
    }, [list, composeStarted, isStaff, scope, filter, openComposer]);

    const handleThreadLoaded = useCallback(({ ticket, messages }, changed) => {
        const matches = !filter || filter === ticket.status || (filter === 'active' && ['open', 'in_progress'].includes(ticket.status));
        if (!matches && changed) loadList();
        const last = messages.at(-1);
        setList(current => {
            const entry = current.tickets.find(item => item.id === ticket.id);
            if (!entry) return current;
            const updated = { ...entry, ...ticket, lastMessage: last?.body, lastAuthorRole: last?.authorRole };
            const others = current.tickets.filter(item => item.id !== updated.id);
            const tickets = !matches ? others : changed ? [updated, ...others] : current.tickets.map(item => item.id === updated.id ? updated : item);
            return { ...current, tickets };
        });
        onUnreadChange?.();
    }, [filter, loadList, onUnreadChange]);

    if (!isOpen) return null;
    const staffView = scope === 'all';
    const paneOpen = view.mode !== 'empty';

    return (
        // The scrim is a sibling, not a parent: a fading ancestor would cut the
        // panel's backdrop-filter off from the page behind it.
        <div className="ticket-layer">
            <div className={`ticket-scrim ${closing ? 'is-closing' : ''}`} onMouseDown={requestClose} aria-hidden="true" />
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ticket-center-title"
                tabIndex={-1}
                className={`ticket-center ${closing ? 'is-closing' : ''}`}
                onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClose?.(); }}
            >
                <header className="ticket-center__header">
                    <div className="flex min-w-0 items-center gap-3">
                        {paneOpen && <button type="button" onClick={returnToList} disabled={busy} className="ticket-icon-button ticket-mobile-back" aria-label="返回工单列表"><ChevronLeft className="h-5 w-5" /></button>}
                        <div className={`ticket-center__mark ${paneOpen ? 'ticket-mark--desktop' : ''}`}><LifeBuoy className="h-5 w-5" /></div>
                        <div className="min-w-0">
                            <h2 id="ticket-center-title" className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-white">工单中心</h2>
                            <p className="ticket-center__subtitle truncate text-xs font-medium text-slate-500 dark:text-slate-400">{isStaff ? '查看用户工单、回复并更新处理状态' : '提交问题并查看管理员回复'}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={openComposer} disabled={busy || view.mode === 'compose'} aria-label="新建工单" className="mc-button mc-button--primary mc-button--compact"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">新建工单</span></button>
                        <button ref={closeButtonRef} type="button" onClick={requestClose} disabled={busy} className="ticket-icon-button" aria-label="关闭工单中心"><X className="h-5 w-5" /></button>
                    </div>
                </header>

                <div className={`ticket-center__body ${paneOpen ? 'has-pane' : ''}`}>
                    <aside ref={sidebarRef} className="ticket-sidebar" aria-label="工单列表">
                        {isStaff && (
                            <div className="ticket-scope" role="tablist" aria-label="工单范围">
                                {[['all', '全部工单'], ['mine', '我提交的']].map(([id, label]) => (
                                    <button key={id} type="button" role="tab" aria-selected={scope === id} disabled={busy} onClick={() => { if (scope !== id) { setScope(id); setView({ mode: 'empty' }); } }} className={scope === id ? 'is-active' : ''}>{label}</button>
                                ))}
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
                            <div className="ticket-filters" role="radiogroup" aria-label="按状态筛选">
                                {FILTERS.map(item => (
                                    <button key={item.id || 'all'} type="button" role="radio" aria-checked={filter === item.id} disabled={busy} onClick={() => setFilter(item.id)} className={filter === item.id ? 'is-active' : ''}>{item.label}</button>
                                ))}
                            </div>
                            <button type="button" onClick={() => loadList()} disabled={list.loading || busy} className="ticket-icon-button ml-auto !h-7 !w-7" aria-label="刷新列表" title="刷新"><RefreshCw className={`h-3.5 w-3.5 ${list.loading ? 'animate-spin' : ''}`} /></button>
                        </div>
                        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                            {list.error ? (
                                <div className="px-3 py-8 text-center"><p className="text-xs font-bold text-red-600 dark:text-red-400">{list.error}</p><button type="button" onClick={() => loadList()} className="mc-button mc-button--secondary mc-button--compact mt-3">重试</button></div>
                            ) : list.loading && !list.tickets.length ? (
                                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
                            ) : !list.tickets.length ? (
                                <div className="px-4 py-10 text-center">
                                    <Inbox className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                                    <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">{filter === 'active' ? '没有进行中的工单' : '这里还没有工单'}</p>
                                    {!staffView && <button type="button" disabled={busy} onClick={openComposer} className="mc-button mc-button--secondary mc-button--compact mt-3"><Plus className="h-3.5 w-3.5" />提交工单</button>}
                                </div>
                            ) : (
                                <>
                                    <ul className="space-y-1.5">
                                        {list.tickets.map(ticket => <TicketListItem key={ticket.id} ticket={ticket} staffView={staffView} currentUserId={currentUserId} selected={view.mode === 'thread' && view.id === ticket.id} disabled={busy} onSelect={id => setView({ mode: 'thread', id })} />)}
                                    </ul>
                                    {list.page < list.totalPages && <button type="button" disabled={list.loading || busy} onClick={() => loadList({ page: list.page + 1, append: true })} className="mc-button mc-button--ghost mc-button--compact mt-2 w-full">{list.loading ? '加载中…' : '加载更多'}</button>}
                                </>
                            )}
                        </div>
                    </aside>

                    <div ref={paneRef} tabIndex={-1} className="ticket-pane">
                        {composeStarted && (
                            <div className="h-full" hidden={view.mode !== 'compose'}>
                                <TicketComposer
                                    cards={cards}
                                    onBusyChange={setBusy}
                                    onCreated={id => {
                                        setComposeStarted(false);
                                        if (filter) setFilter('');
                                        else loadList();
                                        onUnreadChange?.();
                                        setView(id ? { mode: 'thread', id } : { mode: 'empty' });
                                    }}
                                />
                            </div>
                        )}
                        {view.mode === 'thread' && (
                            <TicketThread key={view.id} ticketId={view.id} onLoaded={handleThreadLoaded} onBusyChange={setBusy} />
                        )}
                        {view.mode === 'empty' && (
                            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                                <div className="ticket-empty-mark"><LifeBuoy className="h-7 w-7" /></div>
                                <p className="mt-4 text-sm font-black text-slate-700 dark:text-slate-200">选择左侧的工单查看对话</p>
                                <p className="mt-1 text-xs font-medium text-slate-400">或者点击右上角「新建工单」提交新的问题</p>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
