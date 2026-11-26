import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, LifeBuoy, Loader2, Plus, RefreshCw, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import TicketComposer from './TicketComposer';
import TicketThread, { StatusPill } from './TicketThread';
import { CATEGORY_LABELS, formatRelativeTime } from './ticketShared';

const FILTERS = [
    { id: 'active', label: '进行中' },
    { id: '', label: '全部' },
    { id: 'resolved', label: '已解决' },
    { id: 'closed', label: '已关闭' }
];

function TicketListItem({ ticket, selected, staffView, currentUserId, onSelect }) {
    // An administrator's own ticket is read from the submitter's side.
    const own = String(ticket.userId) === String(currentUserId);
    const unread = staffView && !own ? ticket.staffUnread > 0 && ['open', 'in_progress'].includes(ticket.status) : ticket.userUnread > 0;
    return (
        <li>
            <button type="button" onClick={() => onSelect(ticket.id)} aria-current={selected ? 'true' : undefined} className={`ticket-list-item ${selected ? 'is-selected' : ''}`}>
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
    const [filter, setFilter] = useState('active');
    const [list, setList] = useState({ tickets: [], page: 1, totalPages: 1, loading: true, error: '' });
    const [view, setView] = useState({ mode: 'empty' });
    const [busy, setBusy] = useState(false);
    const requestRef = useRef(0);

    const requestClose = useCallback(() => {
        if (busy) return;
        setClosing(true);
    }, [busy]);
    const dialogRef = useModalAccessibility(isOpen && !closing, requestClose);

    const loadList = useCallback(async ({ page = 1, append = false, quiet = false } = {}) => {
        const request = ++requestRef.current;
        if (!quiet) setList(current => ({ ...current, loading: true, error: '' }));
        try {
            const query = new URLSearchParams({ scope, page: String(page) });
            if (filter) query.set('status', filter);
            const result = await api.get(`/tickets?${query}`, { fallback: '读取工单失败' });
            if (request !== requestRef.current) return;
            setList(current => ({
                tickets: append ? [...current.tickets, ...result.tickets.filter(item => !current.tickets.some(old => old.id === item.id))] : result.tickets,
                page: result.page,
                totalPages: result.totalPages,
                loading: false,
                error: ''
            }));
        } catch (error) {
            if (request === requestRef.current) setList(current => ({ ...current, loading: false, error: error.message || '读取工单失败' }));
        }
    }, [scope, filter]);

    useEffect(() => { if (isOpen) loadList(); }, [isOpen, loadList]);

    // A user without tickets lands straight on the form.
    const autoComposed = useRef(false);
    useEffect(() => {
        if (autoComposed.current || list.loading || list.error) return;
        autoComposed.current = true;
        if (!isStaff && scope === 'mine' && filter === 'active' && !list.tickets.length) setView({ mode: 'compose' });
    }, [list, isStaff, scope, filter]);

    const refreshAfterChange = useCallback(() => {
        loadList({ quiet: true });
        onUnreadChange?.();
    }, [loadList, onUnreadChange]);

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
                        <div className="ticket-center__mark"><LifeBuoy className="h-5 w-5" /></div>
                        <div className="min-w-0">
                            <h2 id="ticket-center-title" className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-white">工单中心</h2>
                            <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{isStaff ? '处理用户提交的问题，回复会通过站内提醒和邮件通知对方' : '遇到问题提交工单，管理员会在这里回复你'}</p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => setView({ mode: 'compose' })} aria-label="新建工单" className="mc-button mc-button--primary mc-button--compact"><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">新建工单</span></button>
                        <button type="button" onClick={requestClose} disabled={busy} className="ticket-icon-button" aria-label="关闭工单中心"><X className="h-5 w-5" /></button>
                    </div>
                </header>

                <div className={`ticket-center__body ${paneOpen ? 'has-pane' : ''}`}>
                    <aside className="ticket-sidebar" aria-label="工单列表">
                        {isStaff && (
                            <div className="ticket-scope" role="tablist" aria-label="工单范围">
                                {[['all', '全部工单'], ['mine', '我提交的']].map(([id, label]) => (
                                    <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => { setScope(id); setView({ mode: 'empty' }); }} className={scope === id ? 'is-active' : ''}>{label}</button>
                                ))}
                            </div>
                        )}
                        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
                            <div className="ticket-filters" role="radiogroup" aria-label="按状态筛选">
                                {FILTERS.map(item => (
                                    <button key={item.id || 'all'} type="button" role="radio" aria-checked={filter === item.id} onClick={() => setFilter(item.id)} className={filter === item.id ? 'is-active' : ''}>{item.label}</button>
                                ))}
                            </div>
                            <button type="button" onClick={() => loadList()} className="ticket-icon-button ml-auto !h-7 !w-7" aria-label="刷新列表" title="刷新"><RefreshCw className={`h-3.5 w-3.5 ${list.loading ? 'animate-spin' : ''}`} /></button>
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
                                    {!staffView && <button type="button" onClick={() => setView({ mode: 'compose' })} className="mc-button mc-button--secondary mc-button--compact mt-3"><Plus className="h-3.5 w-3.5" />提交工单</button>}
                                </div>
                            ) : (
                                <>
                                    <ul className="space-y-1.5">
                                        {list.tickets.map(ticket => <TicketListItem key={ticket.id} ticket={ticket} staffView={staffView} currentUserId={currentUserId} selected={view.mode === 'thread' && view.id === ticket.id} onSelect={id => setView({ mode: 'thread', id })} />)}
                                    </ul>
                                    {list.page < list.totalPages && <button type="button" disabled={list.loading} onClick={() => loadList({ page: list.page + 1, append: true })} className="mc-button mc-button--ghost mc-button--compact mt-2 w-full">{list.loading ? '加载中…' : '加载更多'}</button>}
                                </>
                            )}
                        </div>
                    </aside>

                    <div className="ticket-pane">
                        {view.mode === 'compose' && (
                            <TicketComposer
                                cards={cards}
                                onBusyChange={setBusy}
                                onCreated={id => {
                                    if (scope !== 'mine' && !isStaff) setScope('mine');
                                    setFilter('active');
                                    refreshAfterChange();
                                    setView(id ? { mode: 'thread', id } : { mode: 'empty' });
                                }}
                            />
                        )}
                        {view.mode === 'thread' && (
                            <TicketThread key={view.id} ticketId={view.id} onBack={() => setView({ mode: 'empty' })} onChanged={refreshAfterChange} onBusyChange={setBusy} />
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
