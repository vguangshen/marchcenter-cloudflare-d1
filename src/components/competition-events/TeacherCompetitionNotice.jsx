import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Bell, GraduationCap, Loader2, Timer, Trophy, X } from 'lucide-react';
import { api } from '../../utils/api';
import { getTabToken } from '../../utils/tabSession';
import LoadErrorNotice from '../feedback/LoadErrorNotice';

const ROOT = '/competition-events';
const POLL_MS = 20_000;
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export default function TeacherCompetitionNotice({ token, onEnter }) {
    const panelId = useId();
    const headingId = useId();
    const launcher = useRef(null);
    const later = useRef(null);
    const handled = useRef({ token: null, ids: new Set() });
    const launching = useRef(null);
    const [snapshot, setSnapshot] = useState(null);
    const [visibleFor, setVisibleFor] = useState(null);
    const [launch, setLaunch] = useState(null);
    const events = snapshot?.token === token ? snapshot.events : [];
    const expanded = Boolean(events.length && visibleFor === token);
    const activeLaunch = launch?.token === token ? launch : null;

    useEffect(() => {
        if (!token) return undefined;
        const controller = new AbortController();
        let pending = false;
        const refresh = async () => {
            if (pending || document.visibilityState !== 'visible' || getTabToken() !== token) return;
            pending = true;
            try {
                const data = await api.get(`${ROOT}/mine`, { signal: controller.signal, retry: 0 });
                if (controller.signal.aborted || getTabToken() !== token) return;
                const current = data.events || [];
                if (handled.current.token !== token) handled.current = { token, ids: new Set() };
                const incoming = current.filter(event => !event.seenAt && !handled.current.ids.has(event.id));
                for (const event of incoming) handled.current.ids.add(event.id);
                if (incoming.length) setVisibleFor(token);
                if (!current.length) setVisibleFor(null);
                setSnapshot({ token, events: current });
            } catch {
                // An intermittent refresh leaves the last available notification in place.
            } finally {
                pending = false;
            }
        };
        void refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            controller.abort();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [token]);

    function markSeen(items) {
        if (getTabToken() !== token) return;
        for (const event of items) {
            if (event.seenAt) continue;
            api.post(`${ROOT}/${event.id}/seen`, {}, { retry: 0 }).then(({ event: updated }) => {
                if (!updated?.seenAt || getTabToken() !== token) return;
                setSnapshot(previous => previous?.token === token
                    ? { token, events: previous.events.map(item => item.id === updated.id ? { ...item, seenAt: updated.seenAt } : item) }
                    : previous);
            }).catch(() => { /* The entry remains available in the notice list. */ });
        }
    }

    function hide({ restoreFocus = true } = {}) {
        setVisibleFor(null);
        if (restoreFocus) window.requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
    }

    function dismiss() {
        markSeen(events);
        hide();
    }

    async function enter(event) {
        if (launching.current?.token === token) return;
        const request = { token, id: event.id };
        launching.current = request;
        setLaunch({ ...request, pending: true });
        try {
            const opened = await onEnter(event);
            if (launching.current !== request || getTabToken() !== token) return;
            if (opened) {
                markSeen([event]);
                setLaunch(null);
                if (events.length === 1) hide({ restoreFocus: false });
            } else {
                setLaunch({ ...request, error: '未能打开学生端，请检查入口提示后重试。' });
            }
        } catch (error) {
            if (launching.current === request && getTabToken() === token) {
                setLaunch({ ...request, error: error.message || '未能打开学生端，请重试。' });
            }
        } finally {
            if (launching.current === request) launching.current = null;
        }
    }

    if (!events.length) return null;
    const unread = events.filter(event => !event.seenAt).length;
    return (
        <aside className="competition-notice-dock" aria-label="参赛邀请">
            <span className="sr-only" role="status">{unread ? `你有 ${unread} 条新竞赛通知` : ''}</span>
            {expanded ? (
                <section id={panelId} aria-labelledby={headingId} className="competition-notice"
                    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } }}>
                    <header className="flex items-center gap-3 border-b border-[var(--mc-color-border)] px-4 py-2.5">
                        <span className="competition-event-mark"><Trophy className="h-5 w-5" aria-hidden="true" /></span>
                        <div className="min-w-0 flex-1">
                            <h2 id={headingId} className="text-sm font-black">竞赛通知</h2>
                            <p className="mt-0.5 text-xs text-[var(--mc-color-muted)]">通过学生端参加受邀竞赛</p>
                        </div>
                        <button type="button" ref={later} onClick={dismiss} aria-label="稍后查看竞赛通知" title="稍后查看"
                            className="mc-icon-button !h-9 !w-9 !min-w-9"><X className="h-4 w-4" aria-hidden="true" /></button>
                    </header>
                    <ul className="competition-notice__list">
                        {events.map(event => {
                            const expiry = new Date(event.expiresAt);
                            const busy = activeLaunch?.id === event.id && activeLaunch.pending;
                            return (
                                <li key={event.id}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="break-words text-sm font-extrabold">{event.title}</p>
                                            {event.cardTitle !== event.title && <p className="mt-0.5 break-words text-xs text-[var(--mc-color-muted)]">{event.cardTitle}</p>}
                                            {event.className && (
                                                <p className="mt-1 flex items-start gap-1 text-xs text-[var(--mc-color-muted)]">
                                                    <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                                    <span className="wrap-anywhere">{event.className}</span>
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--mc-color-muted)]">
                                        {event.expiresAt && Number.isFinite(expiry.getTime()) && (
                                            <span className="inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" aria-hidden="true" />
                                                <time dateTime={expiry.toISOString()}>{dateFormat.format(expiry)} 截止</time></span>
                                        )}
                                    </div>
                                    {activeLaunch?.id === event.id && activeLaunch.error && (
                                        <div className="mt-2"><LoadErrorNotice compact message={activeLaunch.error} /></div>
                                    )}
                                    <button type="button" className="mc-button mc-button--accent mc-button--compact mt-2 w-full"
                                        disabled={Boolean(activeLaunch?.pending)} onClick={() => { void enter(event); }}>
                                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
                                        {busy ? '正在打开…' : '进入学生端'}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <footer className="flex justify-end border-t border-[var(--mc-color-border)] px-3 py-1">
                        <button type="button" className="mc-button mc-button--ghost mc-button--compact" onClick={dismiss}>稍后</button>
                    </footer>
                </section>
            ) : (
                <button ref={launcher} type="button" className="mc-button mc-button--secondary competition-notice-launcher"
                    aria-expanded={false} onClick={() => { setVisibleFor(token); window.requestAnimationFrame(() => later.current?.focus({ preventScroll: true })); }}>
                    <Bell className="h-4 w-4 text-[var(--mc-color-accent)]" aria-hidden="true" />竞赛通知
                    <span className="competition-notice-count" aria-label={`${events.length} 场可进入竞赛`}>{events.length > 99 ? '99+' : events.length}</span>
                </button>
            )}
        </aside>
    );
}
