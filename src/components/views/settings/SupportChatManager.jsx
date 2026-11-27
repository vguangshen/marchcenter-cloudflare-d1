import React, { useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Headset, Inbox, Loader2, MessageCircle, RefreshCw, Search, Users, X } from 'lucide-react';
import { api } from '../../../utils/api';
import SupportChatKnowledge from '../../support-chat/SupportChatKnowledge';
import SupportChatSettings from '../../support-chat/SupportChatSettings';
import SupportChatThread from '../../support-chat/SupportChatThread';
import { useVisibleChatPolling } from '../../support-chat/useVisibleChatPolling';

const METRICS = [
    { key: 'totalConversations', label: '全部会话', icon: Users },
    { key: 'humanConversations', label: '人工接待中', icon: Headset },
    { key: 'unreadMessages', label: '未读消息', icon: Inbox },
    { key: 'recentUserMessages', label: '24 小时用户消息', icon: MessageCircle }
];
const QUEUES = [
    { value: 'all', label: '全部' },
    { value: 'human', label: '人工接待' },
    { value: 'unread', label: '未读' }
];
const REPLY_PREFIX = { template: '模板 · ', ai: 'AI · ' };
const countFormat = new Intl.NumberFormat('zh-CN');
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function displayedCount(value) {
    return typeof value === 'number' ? countFormat.format(value) : '—';
}

function Overview({ data, error, onRetry }) {
    return (
        <section aria-label="客服概览" className="space-y-2">
            <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
                {METRICS.map(({ key, label, icon: Icon }) => (
                    <div key={key} className="settings-surface min-w-0 rounded-2xl px-3 py-3 sm:px-4 sm:py-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--system-accent-rgb))]" aria-hidden="true" />{label}
                        </div>
                        <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{displayedCount(data?.[key])}</p>
                    </div>
                ))}
            </div>
            {data && (
                <dl aria-label="近 24 小时回复" className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-slate-600 dark:text-slate-300">
                    <div className="flex items-baseline gap-1.5"><dt>模板回复</dt><dd className="font-semibold tabular-nums">{displayedCount(data.recentTemplateReplies)}</dd></div>
                    <div className="flex items-baseline gap-1.5"><dt>AI 回复</dt><dd className="font-semibold tabular-nums">{displayedCount(data.recentAiReplies)}</dd></div>
                    <div className="flex items-baseline gap-1.5"><dt>人工回复</dt><dd className="font-semibold tabular-nums">{displayedCount(data.recentHumanReplies)}</dd></div>
                </dl>
            )}
            {error && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    <span className="flex-1">{error}</span>
                    <button type="button" onClick={onRetry} className="mc-button mc-button--ghost mc-button--compact">重试</button>
                </div>
            )}
        </section>
    );
}

function ConversationRow({ conversation, selected, onSelect }) {
    const { id, ownerUsername, humanRequested, lastMessage, lastAuthorRole, lastReplySource, staffUnread, updatedAt } = conversation;
    const preview = lastAuthorRole === 'staff' ? REPLY_PREFIX[lastReplySource] || '客服 · ' : '';
    const time = Date.parse(updatedAt);
    return (
        <li>
            <button type="button" data-support-conversation={id} onClick={() => onSelect(conversation)} aria-current={selected ? 'true' : undefined}
                className={`flex w-full min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--system-accent)] ${selected ? 'border-[rgb(var(--system-accent-rgb)/.28)] bg-[rgb(var(--system-accent-rgb)/.09)]' : 'border-transparent hover:bg-slate-500/8'}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgb(var(--system-accent-rgb)/.12)] text-[rgb(var(--system-accent-rgb))]" aria-hidden="true">
                    <MessageCircle className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{ownerUsername}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">#{id}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-600 dark:text-slate-300">{lastMessage ? `${preview}${lastMessage}` : '暂无消息'}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                    {Number.isFinite(time) && <time dateTime={updatedAt} className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{dateFormat.format(time)}</time>}
                    <span className="flex items-center gap-1">
                        {humanRequested && <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300">人工</span>}
                        {staffUnread > 0 && <span aria-label={`${staffUnread} 条未读消息`} className="min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] tabular-nums font-bold text-white">{staffUnread > 99 ? '99+' : staffUnread}</span>}
                    </span>
                </span>
            </button>
        </li>
    );
}

export default function SupportChatManager({ active = true, canConfigure, onOpenAiSettings, onUnreadChange }) {
    const [tab, setTab] = useState('inbox');
    const [knowledgeOpened, setKnowledgeOpened] = useState(false);
    const [settingsOpened, setSettingsOpened] = useState(false);
    const [queue, setQueue] = useState('all');
    const [page, setPage] = useState(1);
    const [draftQuery, setDraftQuery] = useState('');
    const [query, setQuery] = useState('');
    const [list, setList] = useState(null);
    const [overview, setOverview] = useState(null);
    const [overviewError, setOverviewError] = useState('');
    const [selected, setSelected] = useState(null);
    const [revision, setRevision] = useState(0);
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const headingRef = useRef(null);

    const knowledge = tab === 'knowledge';
    const automation = canConfigure && tab === 'automation';
    const inbox = !knowledge && !automation;
    const inboxActive = active && inbox;
    const params = new URLSearchParams({ scope: 'all', queue, page: String(page) });
    if (query) params.set('q', query);
    const listKey = params.toString();
    const current = list?.key === listKey ? list : null;

    const refresh = () => setRevision(value => value + 1);
    const updateUnread = () => {
        refresh();
        onUnreadChange?.();
    };

    useVisibleChatPolling(inboxActive, async signal => {
        try {
            const result = await api.get('/support-chat/management/overview', { signal, retry: 0, fallback: '读取客服概览失败' });
            if (!signal.aborted) {
                setOverview(result);
                setOverviewError('');
            }
        } catch (failure) {
            if (!signal.aborted) setOverviewError(failure.message || '读取客服概览失败');
        }
    }, revision);

    useVisibleChatPolling(inboxActive, async signal => {
        try {
            const result = await api.get(`/support-chat/conversations?${listKey}`, { signal, retry: 0, fallback: '读取客服会话失败' });
            if (signal.aborted) return;
            if (page > result.totalPages && result.totalPages > 0) setPage(result.totalPages);
            setList({ key: listKey, result, error: '' });
        } catch (failure) {
            if (!signal.aborted) setList(previous => ({
                key: listKey,
                result: previous?.key === listKey ? previous.result : null,
                error: failure.message || '读取客服会话失败'
            }));
        }
    }, `${revision}:${listKey}`);

    const applySearch = value => {
        setQuery(value.trim());
        setPage(1);
        setSelected(null);
    };

    const selectConversation = conversation => {
        setSelected(conversation);
        window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    };

    const backToList = () => {
        const number = selected.id;
        setSelected(null);
        window.requestAnimationFrame(() => {
            const row = listRef.current?.querySelector(`[data-support-conversation="${number}"]`);
            (row || searchRef.current)?.focus({ preventScroll: true });
        });
    };

    return (
        <section className="min-w-0 space-y-4" aria-labelledby="support-management-title">
            <header className="settings-surface flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[rgb(var(--system-accent-rgb)/.12)] text-[rgb(var(--system-accent-rgb))]"><Headset className="h-5 w-5" aria-hidden="true" /></span>
                    <h2 id="support-management-title" className="text-lg font-bold text-slate-900 dark:text-white">客服管理</h2>
                </div>
                <div role="group" aria-label="客服管理视图" className="flex flex-wrap gap-1.5">
                    <button type="button" aria-pressed={inbox} onClick={() => setTab('inbox')} className={`mc-button mc-button--compact ${inbox ? 'mc-button--secondary' : 'mc-button--ghost'}`}>用户会话</button>
                    <button type="button" aria-pressed={knowledge} onClick={() => { setTab('knowledge'); setKnowledgeOpened(true); }} className={`mc-button mc-button--compact ${knowledge ? 'mc-button--secondary' : 'mc-button--ghost'}`}>问答语料</button>
                    {canConfigure && <button type="button" aria-pressed={automation} onClick={() => { setTab('automation'); setSettingsOpened(true); }} className={`mc-button mc-button--compact ${automation ? 'mc-button--secondary' : 'mc-button--ghost'}`}>自动回复</button>}
                </div>
            </header>

            <div className={inbox ? 'space-y-3' : 'hidden'}>
                <Overview data={overview} error={overviewError} onRetry={refresh} />
                <div className="settings-surface overflow-hidden rounded-2xl lg:grid lg:grid-cols-[minmax(15rem,34%)_minmax(0,1fr)]">
                    <section className={`${selected ? 'hidden lg:flex' : 'flex'} min-w-0 flex-col lg:h-[clamp(30rem,66dvh,43rem)] lg:border-r lg:border-slate-300/50 lg:dark:border-slate-600/50`} aria-label="客服会话列表">
                        <div className="shrink-0 space-y-2.5 border-b border-slate-300/40 p-3 dark:border-slate-600/40">
                            <form onSubmit={event => { event.preventDefault(); applySearch(draftQuery); }} className="flex gap-1.5" role="search" aria-label="搜索客服会话">
                                <div className="relative min-w-0 flex-1">
                                    <input ref={searchRef} aria-label="用户名或会话编号" placeholder="用户名或会话编号" value={draftQuery} maxLength={80}
                                        onChange={event => setDraftQuery(event.target.value)} className="mc-input mc-input--compact !pr-8" />
                                    {draftQuery && <button type="button" aria-label="清除搜索" onClick={() => { setDraftQuery(''); applySearch(''); searchRef.current?.focus(); }}
                                        className="absolute inset-y-0 right-1 grid w-7 place-items-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                                </div>
                                <button type="submit" aria-label="搜索" className="mc-button mc-button--secondary mc-button--compact shrink-0"><Search className="h-4 w-4" aria-hidden="true" /></button>
                            </form>
                            <div className="flex items-center gap-1">
                                <div role="group" aria-label="筛选客服会话" className="flex min-w-0 flex-1 flex-wrap gap-1">
                                    {QUEUES.map(({ value, label }) => <button key={value} type="button" aria-pressed={queue === value} onClick={() => { setQueue(value); setPage(1); setSelected(null); }}
                                        className={`mc-button mc-button--compact !min-h-8 !px-2 ${queue === value ? 'mc-button--secondary' : 'mc-button--ghost'}`}>{label}</button>)}
                                </div>
                                <button type="button" onClick={refresh} aria-label="刷新会话" className="mc-button mc-button--ghost mc-button--compact !min-h-8 !px-2"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></button>
                            </div>
                        </div>
                        <div ref={listRef} className="custom-scrollbar min-h-0 flex-1 p-2 lg:overflow-y-auto">
                            {current?.error && <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{current.error}</p>}
                            {!current ? <div className="flex justify-center py-10" role="status" aria-label="正在读取会话"><Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" /></div> : current.result?.conversations.length ? (
                                <ul className="space-y-0.5">
                                    {current.result.conversations.map(conversation => <ConversationRow key={conversation.id} conversation={conversation} selected={selected?.id === conversation.id} onSelect={selectConversation} />)}
                                </ul>
                            ) : !current.error && <p className="px-2 py-9 text-center text-sm text-slate-500 dark:text-slate-400">{query ? '没有找到符合条件的会话。' : '暂无会话。'}</p>}
                        </div>
                        {current?.result?.totalPages > 1 && <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-300/40 px-3 py-2 dark:border-slate-600/40" aria-label="会话分页">
                            <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="mc-button mc-button--ghost mc-button--compact" aria-label="上一页"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                            <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{page} / {current.result.totalPages}</span>
                            <button type="button" disabled={page >= current.result.totalPages} onClick={() => setPage(page + 1)} className="mc-button mc-button--ghost mc-button--compact" aria-label="下一页"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                        </div>}
                    </section>

                    {selected ? (
                        <section className="flex h-[clamp(30rem,66dvh,43rem)] min-w-0 flex-col" aria-labelledby="support-management-thread-title">
                            <div className="flex shrink-0 items-center gap-3 border-b border-slate-300/40 px-3 py-2.5 dark:border-slate-600/40">
                                <button type="button" onClick={backToList} className="mc-button mc-button--ghost mc-button--compact !px-2" aria-label="返回会话列表"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                                <h3 ref={headingRef} id="support-management-thread-title" tabIndex={-1} className="min-w-0 truncate font-semibold text-slate-900 outline-none dark:text-white">{selected.ownerUsername}</h3>
                                <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">#{selected.id}</span>
                            </div>
                            <SupportChatThread key={selected.id} active={inboxActive} initialConversation={selected} onUnreadChange={updateUnread} />
                        </section>
                    ) : (
                        <div className="hidden h-[clamp(30rem,66dvh,43rem)] place-content-center text-center text-sm text-slate-500 lg:grid dark:text-slate-400">
                            <MessageCircle className="mx-auto mb-2 h-7 w-7" aria-hidden="true" />选择一个会话查看消息
                        </div>
                    )}
                </div>
            </div>

            {knowledgeOpened && <div className={knowledge ? 'min-w-0' : 'hidden'}><SupportChatKnowledge active={active && knowledge} /></div>}

            {canConfigure && settingsOpened && (
                <section className={automation ? 'settings-surface flex h-[clamp(32rem,73dvh,46rem)] min-w-0 flex-col overflow-clip rounded-2xl' : 'hidden'} aria-label="客服自动回复">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-300/40 px-4 py-2.5 dark:border-slate-600/40">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">自动回复设置</h3>
                        {onOpenAiSettings && <button type="button" onClick={onOpenAiSettings} className="mc-button mc-button--ghost mc-button--compact">AI 接口配置<ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                    </div>
                    <SupportChatSettings active={active && automation} />
                </section>
            )}
        </section>
    );
}
