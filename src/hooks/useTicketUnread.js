import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

const POLL_MS = 60_000;

/**
 * Unread ticket count for the navbar badge: the user's own tickets with new
 * administrator replies plus, for administrators, tickets awaiting them.
 * Polls while the tab is visible and catches up when it becomes visible.
 */
export function useTicketUnread(enabled) {
    const [count, setCount] = useState(0);
    const inflight = useRef(null);

    const refresh = useCallback(() => {
        if (!enabled) return Promise.resolve();
        if (inflight.current) return inflight.current;
        inflight.current = api.get('/tickets/unread', { retry: 0, fallback: '读取工单提醒失败' })
            .then(result => setCount(Math.max(0, Number(result?.total) || 0)))
            .catch(() => { /* The badge is best-effort; keep the last count. */ })
            .finally(() => { inflight.current = null; });
        return inflight.current;
    }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            setCount(0);
            return undefined;
        }
        refresh();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh();
        }, POLL_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [enabled, refresh]);

    return { count, refresh };
}
