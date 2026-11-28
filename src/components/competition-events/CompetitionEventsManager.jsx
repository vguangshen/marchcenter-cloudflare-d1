import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Flag, GraduationCap, Loader2, RefreshCw, Search, Timer, Trophy, Users, X } from 'lucide-react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { api } from '../../utils/api';
import LoadErrorNotice from '../feedback/LoadErrorNotice';
import { SSO_METHOD_OPTIONS } from '../modals/competitionEditConfig';

const ROOT = '/competition-events';
const DURATIONS = [
    [1, '1 小时'], [4, '4 小时'], [8, '8 小时'], [24, '24 小时'], [72, '3 天'], [168, '7 天']
];
const MAX_TEACHERS = 100;
const MAX_CLASS_NAME = 60;
const PREPARE_TIMEOUT_MS = 100_000;
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function dateLabel(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? dateFormat.format(date) : '—';
}

function ssoProfileLabel(profile) {
    const methodName = SSO_METHOD_OPTIONS.find(method => method.id === profile.method)?.name || profile.method;
    if (!profile.name) return methodName;
    return methodName && !profile.name.includes(methodName) ? `${profile.name} · ${methodName}` : profile.name;
}

function SearchBox({ label, value, onChange, inputRef }) {
    return (
        <label className="relative block">
            <span className="sr-only">{label}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input ref={inputRef} className="mc-input mc-input--compact !pl-9" type="search" maxLength={120}
                value={value} placeholder={label} onChange={event => onChange(event.target.value)} />
        </label>
    );
}

function TeacherPicker({ selected, onToggle, disabled }) {
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [request, setRequest] = useState(null);
    const [retry, setRetry] = useState(0);
    const search = query.trim();
    const key = JSON.stringify([search, page, retry]);

    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams({ q: search, page });
        const timer = window.setTimeout(() => {
            api.get(`${ROOT}/teachers?${params}`, { signal: controller.signal, retry: 0, fallback: '教师账号读取失败' })
                .then(result => { if (!controller.signal.aborted) setRequest({ key, result }); })
                .catch(error => { if (!controller.signal.aborted) setRequest({ key, error: error.message }); });
        }, search ? 180 : 0);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [key, page, search]);

    const current = request?.key === key ? request : null;
    const result = current?.result;
    const teachers = result?.teachers || [];
    const shownPage = result?.page ?? page;
    const atLimit = selected.size >= MAX_TEACHERS;
    return (
        <section className="competition-event-picker" aria-label="选择参赛的 mcgo 教师">
            <div className="competition-event-picker__heading">
                <Users className="h-4 w-4 text-[var(--mc-color-accent)]" aria-hidden="true" />
                <h3 className="font-extrabold">参赛的 mcgo 教师</h3>
                <span className="ml-auto whitespace-nowrap text-xs font-semibold text-[var(--mc-color-muted)]">已选 {selected.size} 人</span>
            </div>
            <SearchBox label="搜索教师账号" value={query} onChange={next => { setQuery(next); setPage(1); }} />
            <div className="competition-event-picker__list" aria-busy={!current}>
                {!current && <p role="status" className="competition-event-empty">正在读取教师账号…</p>}
                {current?.error && <LoadErrorNotice compact message={current.error} onRetry={() => setRetry(count => count + 1)} />}
                {result && teachers.length === 0 && <p className="competition-event-empty">没有符合条件的教师账号。</p>}
                {teachers.map(teacher => {
                    const checked = selected.has(teacher.id);
                    return (
                        <label key={teacher.id} className="competition-event-option" data-selected={checked}>
                            <input type="checkbox" checked={checked} disabled={disabled || (atLimit && !checked)}
                                onChange={() => onToggle(teacher)} className="h-4 w-4 shrink-0 accent-[var(--mc-color-accent)]" />
                            <span className="min-w-0 truncate font-semibold" title={teacher.username}>{teacher.username}</span>
                        </label>
                    );
                })}
            </div>
            {result?.totalPages > 1 && (
                <nav className="flex items-center justify-between gap-2 border-t border-[var(--mc-color-border)] pt-2" aria-label="教师账号分页">
                    <button className="mc-icon-button mc-icon-button--compact" type="button" aria-label="上一页教师"
                        disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                    <span className="text-xs text-[var(--mc-color-muted)]">第 {shownPage} / {result.totalPages} 页</span>
                    <button className="mc-icon-button mc-icon-button--compact" type="button" aria-label="下一页教师"
                        disabled={shownPage >= result.totalPages} onClick={() => setPage(shownPage + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                </nav>
            )}
            {selected.size > 0 && (
                <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto border-t border-[var(--mc-color-border)] pt-2" aria-label="已选教师">
                    {Array.from(selected.values(), teacher => (
                        <button type="button" key={teacher.id} onClick={() => onToggle(teacher)} disabled={disabled}
                            aria-label={`移除教师 ${teacher.username}`} className="competition-event-tag">
                            <span className="truncate">{teacher.username}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </button>
                    ))}
                </div>
            )}
            {atLimit && <p className="text-xs text-[var(--mc-color-muted)]">一场竞赛最多邀请 {MAX_TEACHERS} 位教师。</p>}
        </section>
    );
}

export default function CompetitionEventsManager({ onClose, onEnterTeacher }) {
    const titleId = useId();
    const formId = useId();
    const cardSearchRef = useRef(null);
    const recordsTabRef = useRef(null);
    const bodyRef = useRef(null);
    const [tab, setTab] = useState('publish');
    const [cardsResult, setCardsResult] = useState(null);
    const [eventsResult, setEventsResult] = useState(null);
    const [cardsRevision, setCardsRevision] = useState(0);
    const [eventsRevision, setEventsRevision] = useState(0);
    const [cardQuery, setCardQuery] = useState('');
    const [competitionId, setCompetitionId] = useState(null);
    const [ssoConfigId, setSsoConfigId] = useState(null);
    const [teachers, setTeachers] = useState(() => new Map());
    const [title, setTitle] = useState('');
    const [className, setClassName] = useState('');
    const [durationHours, setDurationHours] = useState(24);
    const [actionError, setActionError] = useState('');
    const [status, setStatus] = useState('');
    const [confirmId, setConfirmId] = useState(null);
    const [writing, setWriting] = useState('');
    const [teacherLaunch, setTeacherLaunch] = useState(null);
    const writer = useRef(null);
    const createAttempt = useRef(null);
    const teacherLauncher = useRef(null);
    const close = () => { if (!writer.current) onClose(); };
    const dialogRef = useModalAccessibility(true, close, { initialFocusRef: cardSearchRef });
    const cards = cardsResult?.items || [];
    const events = eventsResult?.items || [];
    const pending = Boolean(writing);
    const chosenCard = cards.find(card => card.id === competitionId);
    const ssoSelection = chosenCard?.ssoSelection;
    const ssoProfile = ssoSelection?.mode === 'auto'
        ? ssoSelection.profile
        : ssoSelection?.profiles?.find(profile => profile.id === ssoConfigId);
    const canPublish = Boolean(chosenCard && ssoProfile && teachers.size && className.trim());
    const filter = cardQuery.trim().toLocaleLowerCase();
    const filteredCards = cards.filter(card => !filter || `${card.title} ${card.category || ''}`.toLocaleLowerCase().includes(filter));

    useEffect(() => {
        const controller = new AbortController();
        api.get(`${ROOT}/cards`, { signal: controller.signal, retry: 0, fallback: '竞赛卡片读取失败' })
            .then(result => { if (!controller.signal.aborted) setCardsResult({ items: result.cards || [] }); })
            .catch(error => { if (!controller.signal.aborted) setCardsResult({ error: error.message }); });
        return () => controller.abort();
    }, [cardsRevision]);

    useEffect(() => {
        if (tab !== 'manage') return undefined;
        const controller = new AbortController();
        let timer;
        async function load() {
            try {
                const result = await api.get(`${ROOT}/manage`, { signal: controller.signal, retry: 0, fallback: '竞赛记录读取失败' });
                if (controller.signal.aborted) return;
                const items = result.events || [];
                setEventsResult({ items });
                if (items.some(event => event.status === 'preparing')) timer = window.setTimeout(load, 5000);
            } catch (error) {
                if (!controller.signal.aborted) setEventsResult({ error: error.message });
            }
        }
        void load();
        return () => { controller.abort(); window.clearTimeout(timer); };
    }, [eventsRevision, tab]);

    useEffect(() => () => writer.current?.abort(), []);
    useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [tab]);

    function selectCard(cardId) {
        setCompetitionId(cardId);
        setSsoConfigId(null);
    }

    function toggleTeacher(teacher) {
        setTeachers(previous => {
            const next = new Map(previous);
            if (next.has(teacher.id)) next.delete(teacher.id);
            else if (next.size < MAX_TEACHERS) next.set(teacher.id, teacher);
            return next;
        });
    }

    function updateEvent(updated) {
        setEventsResult(previous => ({
            items: [updated, ...(previous?.items || []).filter(item => item.id !== updated.id)]
        }));
    }

    async function write(path, data, onSuccess, { timeoutMs, prepare = false } = {}) {
        if (writer.current) return;
        const controller = new AbortController();
        writer.current = controller;
        setWriting(path);
        setActionError('');
        setStatus('');
        try {
            const result = await api.post(path, data, { signal: controller.signal, retry: 0, timeoutMs, fallback: '竞赛操作失败' });
            if (!controller.signal.aborted) onSuccess(result.event);
        } catch (error) {
            if (!controller.signal.aborted) {
                const details = error.message || '竞赛操作失败';
                const canCheckRecords = prepare && (!error.status || error.status === 409 || error.status >= 500);
                setActionError(canCheckRecords ? `${details}。可在竞赛记录中查看创建状态。` : details);
            }
        } finally {
            if (!controller.signal.aborted) {
                writer.current = null;
                setWriting('');
                if (prepare) setEventsRevision(count => count + 1);
            }
        }
    }

    function publish(event) {
        event.preventDefault();
        if (!canPublish) return;
        const data = {
            competitionId: chosenCard.id, teacherIds: [...teachers.keys()].sort((left, right) => left - right),
            title: title.trim() || undefined, className: className.trim(), durationHours,
            ...(ssoSelection.mode === 'manual' && { ssoConfigId: ssoProfile.id })
        };
        const key = JSON.stringify(data);
        if (createAttempt.current?.key !== key) createAttempt.current = { key, id: crypto.randomUUID() };
        void write(ROOT, { ...data, requestId: createAttempt.current.id }, published => {
            createAttempt.current = null;
            updateEvent(published);
            if (published.status !== 'open') {
                setActionError('上一次提交的参赛入口已失效。再次确认可创建新的竞赛班级。');
                return;
            }
            setTitle('');
            setClassName('');
            setTeachers(new Map());
            selectCard(null);
            setStatus(`竞赛班级已创建，已通知 ${published.teacherCount} 位参赛教师。`);
            setTab('manage');
            window.requestAnimationFrame(() => recordsTabRef.current?.focus({ preventScroll: true }));
        }, { timeoutMs: PREPARE_TIMEOUT_MS, prepare: true });
    }

    function retryPreparation(event) {
        void write(`${ROOT}/${event.id}/prepare`, {}, prepared => {
            updateEvent(prepared);
            if (prepared.status === 'open') setStatus(`竞赛班级已创建，已通知 ${prepared.teacherCount} 位参赛教师。`);
        }, { timeoutMs: PREPARE_TIMEOUT_MS, prepare: true });
    }

    function endEvent(event) {
        void write(`${ROOT}/${event.id}/close`, {}, closed => {
            updateEvent(closed);
            setConfirmId(null);
            setStatus(event.status === 'failed' ? '竞赛创建已取消。' : '竞赛已结束，参赛入口已关闭。');
        });
    }

    function switchTab(next) {
        setTab(next);
        setActionError('');
        setStatus('');
        setConfirmId(null);
    }

    async function enterTeacher(event) {
        if (teacherLauncher.current) return;
        teacherLauncher.current = event.id;
        setTeacherLaunch({ id: event.id, pending: true });
        try {
            const opened = await onEnterTeacher(event);
            setTeacherLaunch(opened ? null : { id: event.id, error: '未能打开教师端，请检查入口提示后重试。' });
        } catch (error) {
            setTeacherLaunch({ id: event.id, error: error.message || '未能打开教师端，请重试。' });
        } finally {
            teacherLauncher.current = null;
        }
    }

    const publishActive = tab === 'publish';
    return (
        <div className="mc-modal-backdrop mc-modal-backdrop--top" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
                className="mc-modal mc-modal--medium competition-event-modal">
                <header className="mc-modal__header">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="competition-event-mark"><Trophy aria-hidden="true" className="h-5 w-5" /></span>
                        <div className="min-w-0">
                            <h2 id={titleId} className="text-base font-black">开启竞赛</h2>
                            <p className="mt-0.5 text-xs leading-5 text-[var(--mc-color-muted)]">在所选平台创建独立的竞赛班级。</p>
                        </div>
                    </div>
                    <button className="mc-icon-button mc-modal__close" type="button" disabled={pending} onClick={close} aria-label="关闭竞赛窗口">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>
                <div className="competition-event-tabs" role="group" aria-label="竞赛选项">
                    <button type="button" aria-pressed={publishActive} disabled={pending} onClick={() => switchTab('publish')}>开启竞赛</button>
                    <button ref={recordsTabRef} type="button" aria-pressed={!publishActive} disabled={pending}
                        onClick={() => switchTab('manage')}>竞赛记录</button>
                </div>
                <div ref={bodyRef} className="mc-modal__body space-y-3">
                    {status && <p className="mc-alert mc-alert--success" role="status">{status}</p>}
                    <LoadErrorNotice compact message={actionError} />
                    {publishActive ? (
                        <form id={formId} onSubmit={publish} className="space-y-4">
                            <div className="grid items-start gap-3 sm:grid-cols-2">
                                <section className="competition-event-picker" aria-label="选择竞赛卡片">
                                    <div className="competition-event-picker__heading">
                                        <Flag className="h-4 w-4 text-[var(--mc-color-accent)]" aria-hidden="true" />
                                        <h3 className="font-extrabold">选择竞赛卡片</h3>
                                    </div>
                                    <SearchBox label="搜索卡片名称或分类" value={cardQuery} onChange={setCardQuery} inputRef={cardSearchRef} />
                                    <div className="competition-event-picker__list" aria-busy={!cardsResult}>
                                        {!cardsResult && <p role="status" className="competition-event-empty">正在读取竞赛卡片…</p>}
                                        {cardsResult?.error && <LoadErrorNotice compact message={cardsResult.error}
                                            onRetry={() => { setCardsResult(null); setCardsRevision(count => count + 1); }} />}
                                        {cardsResult?.items && filteredCards.length === 0 &&
                                            <p className="competition-event-empty">{filter ? '没有找到匹配的竞赛卡片。' : '当前没有可选卡片。请在「系统管理 → 免密登录配置」中配置支持独立建班的接入方式。'}</p>}
                                        {filteredCards.map(card => (
                                            <label key={card.id} className="competition-event-option" data-selected={competitionId === card.id}>
                                                <input type="radio" name="competition-event-card" value={card.id} checked={competitionId === card.id}
                                                    disabled={pending} onChange={() => selectCard(card.id)} className="h-4 w-4 shrink-0 accent-[var(--mc-color-accent)]" />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-semibold" title={card.title}>{card.title}</span>
                                                    <span className="block truncate text-xs text-[var(--mc-color-muted)]">
                                                        {[card.category, card.ssoSelection?.mode === 'manual' ? '需选择免密配置' : '支持独立建班'].filter(Boolean).join(' · ')}
                                                    </span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </section>
                                <TeacherPicker selected={teachers} onToggle={toggleTeacher} disabled={pending} />
                            </div>
                            {ssoSelection?.mode === 'auto' && ssoProfile && (
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm" aria-live="polite">
                                    <span className="font-bold">免密配置</span>
                                    <span className="wrap-anywhere">{ssoProfileLabel(ssoProfile)}</span>
                                    <span className="text-xs text-[var(--mc-color-muted)]">自动识别</span>
                                </div>
                            )}
                            {ssoSelection?.mode === 'manual' && (
                                <label className="grid min-w-0 gap-1.5 text-sm font-bold">
                                    免密配置
                                    <select className="mc-input mc-input--compact min-w-0" value={ssoProfile?.id ?? ''}
                                        disabled={pending} required onChange={event => setSsoConfigId(Number(event.target.value) || null)}>
                                        <option value="">请选择建班和跳转方式</option>
                                        {ssoSelection.profiles.map(profile => (
                                            <option key={profile.id} value={profile.id}>{ssoProfileLabel(profile)}</option>
                                        ))}
                                    </select>
                                </label>
                            )}
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
                                <label className="grid min-w-0 gap-1.5 text-sm font-bold">
                                    班级名称
                                    <input className="mc-input mc-input--compact" value={className} disabled={pending}
                                        onChange={event => setClassName(event.target.value)} maxLength={MAX_CLASS_NAME}
                                        placeholder="例如春季技能赛 A 班" required />
                                </label>
                                <label className="grid gap-1.5 text-sm font-bold">
                                    竞赛名称 <span className="sr-only">（选填）</span>
                                    <input className="mc-input mc-input--compact" value={title} disabled={pending}
                                        onChange={event => setTitle(event.target.value)} maxLength={120}
                                        placeholder={chosenCard ? chosenCard.title : '选填，默认使用卡片名称'} />
                                </label>
                                <label className="grid gap-1.5 text-sm font-bold">
                                    参赛有效期
                                    <select className="mc-input mc-input--compact" value={durationHours} disabled={pending}
                                        onChange={event => setDurationHours(Number(event.target.value))}>
                                        {DURATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </label>
                            </div>
                            <p className="flex items-start gap-2 text-xs leading-5 text-[var(--mc-color-muted)]">
                                <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mc-color-accent)]" aria-hidden="true" />
                                <span>管理员使用专用教师账号管理该班，受邀的 mcgo 教师使用该班的学生账号参赛。</span>
                            </p>
                        </form>
                    ) : (
                        <div className="space-y-2" aria-busy={!eventsResult}>
                            {!eventsResult && <p className="competition-event-empty" role="status">正在读取竞赛记录…</p>}
                            {eventsResult?.error && <LoadErrorNotice compact message={eventsResult.error}
                                onRetry={() => { setEventsResult(null); setEventsRevision(count => count + 1); }} />}
                            {eventsResult?.items && events.length === 0 && <p className="competition-event-empty">还没有已开启的竞赛。</p>}
                            {events.map(event => {
                                const active = event.status === 'open';
                                const failed = event.status === 'failed';
                                const canEnd = active || failed || event.status === 'inactive';
                                const hasStarted = Boolean(event.startedAt || event.expiresAt);
                                const canEnterTeacher = active && event.className && event.canEnterTeacher !== false && onEnterTeacher;
                                const teacherLaunchPending = teacherLaunch?.id === event.id && teacherLaunch.pending;
                                const isPreparing = writing === `${ROOT}/${event.id}/prepare`;
                                const label = {
                                    open: '进行中', expired: '已到期', inactive: '入口已变更', closed: '已结束',
                                    preparing: '创建中', failed: '创建失败'
                                }[event.status];
                                return (
                                    <article key={event.id} className="competition-event-record">
                                        <div className="flex flex-wrap items-start gap-2">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="break-words font-extrabold">{event.title}</h3>
                                                <p className="mt-1 break-words text-xs text-[var(--mc-color-muted)]">{event.cardTitle} · {event.teacherCount} 位参赛教师</p>
                                                {event.className && (
                                                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                                        <div className="flex min-w-0 gap-1.5">
                                                            <dt className="shrink-0 text-[var(--mc-color-muted)]">班级</dt>
                                                            <dd className="wrap-anywhere font-semibold">{event.className}</dd>
                                                        </div>
                                                        {event.platformClassName && event.platformClassName !== event.className && (
                                                            <div className="flex min-w-0 gap-1.5">
                                                                <dt className="shrink-0 text-[var(--mc-color-muted)]">平台班级</dt>
                                                                <dd className="wrap-anywhere font-mono">{event.platformClassName}</dd>
                                                            </div>
                                                        )}
                                                        {event.teacherAccountName && (
                                                            <div className="flex min-w-0 gap-1.5">
                                                                <dt className="shrink-0 text-[var(--mc-color-muted)]">教师账号</dt>
                                                                <dd className="wrap-anywhere font-mono">{event.teacherAccountName}</dd>
                                                            </div>
                                                        )}
                                                        {event.ssoConfiguration && (
                                                            <div className="flex min-w-0 gap-1.5">
                                                                <dt className="shrink-0 text-[var(--mc-color-muted)]">免密配置</dt>
                                                                <dd className="wrap-anywhere">{ssoProfileLabel(event.ssoConfiguration)}</dd>
                                                            </div>
                                                        )}
                                                    </dl>
                                                )}
                                            </div>
                                            <span className="competition-event-status" data-active={active}>{label}</span>
                                        </div>
                                        {event.teacherNames?.length > 0 && (
                                            <details className="mt-2 text-xs text-[var(--mc-color-muted)]">
                                                <summary className="w-fit cursor-pointer font-semibold">查看参赛名单</summary>
                                                <p className="mt-1 break-words leading-5">{event.teacherNames.join('、')}</p>
                                            </details>
                                        )}
                                        {active && event.className && event.canEnterTeacher === false && (
                                            <p className="mt-2 text-xs text-[var(--mc-color-muted)]">由创建者进入教师端。</p>
                                        )}
                                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                            <p className="flex items-center gap-1.5 text-xs text-[var(--mc-color-muted)]">
                                                <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                                                {hasStarted ? `${dateLabel(event.startedAt || event.createdAt)} 开启 · ${dateLabel(event.expiresAt)} 截止` : `${dateLabel(event.createdAt)} 提交`}
                                            </p>
                                            {confirmId !== event.id && (canEnterTeacher || canEnd || event.canRetry) && (
                                                <div className="ml-auto flex flex-wrap justify-end gap-2">
                                                    {event.canRetry && (
                                                        <button type="button" className="mc-button mc-button--accent mc-button--compact"
                                                            disabled={pending} onClick={() => retryPreparation(event)}>
                                                            {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                                                            {isPreparing ? '正在创建…' : '重试创建'}
                                                        </button>
                                                    )}
                                                    {canEnterTeacher && (
                                                        <button type="button" className="mc-button mc-button--accent mc-button--compact"
                                                            disabled={pending || Boolean(teacherLaunch?.pending)} onClick={() => { void enterTeacher(event); }}>
                                                            {teacherLaunchPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
                                                            {teacherLaunchPending ? '正在打开…' : '进入教师端'}
                                                        </button>
                                                    )}
                                                    {canEnd && <button type="button" className="mc-button mc-button--secondary mc-button--compact"
                                                        disabled={pending || Boolean(teacherLaunchPending)} onClick={() => setConfirmId(event.id)}>{failed ? '取消创建' : '结束竞赛'}</button>}
                                                </div>
                                            )}
                                        </div>
                                        {teacherLaunch?.id === event.id && teacherLaunch.error && (
                                            <div className="mt-2"><LoadErrorNotice compact message={teacherLaunch.error} /></div>
                                        )}
                                        {confirmId === event.id && canEnd && (
                                            <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--mc-color-border)] pt-2">
                                                <p className="mr-auto text-xs text-[var(--mc-color-muted)]">{failed ? '取消后，这条记录将无法继续创建班级。' : '结束后将关闭本场竞赛的教师端和学生端入口。'}</p>
                                                <button type="button" className="mc-button mc-button--secondary mc-button--compact" disabled={pending}
                                                    onClick={() => setConfirmId(null)}>取消</button>
                                                <button type="button" className="mc-button mc-button--danger mc-button--compact" disabled={pending}
                                                    onClick={() => endEvent(event)}>{failed ? '确认取消' : '确认结束'}</button>
                                            </div>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </div>
                <footer className="mc-modal__footer">
                    <button type="button" className="mc-button mc-button--secondary" disabled={pending} onClick={close}>关闭</button>
                    {publishActive && (
                        <button type="submit" form={formId} className="mc-button mc-button--accent" disabled={pending || !canPublish}>
                            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                            {pending ? '正在创建班级与账号…' : '开启竞赛并通知教师'}
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}
