import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';
import { getTabToken } from '../utils/tabSession';

const POLL_MS = 60_000;

/**
 * Unread ticket count for the navbar badge: the user's own tickets with new
 * administrator replies plus, for administrators, tickets awaiting them.
 * Polls while the tab is visible and catches up when it becomes visible.
 */
export function useTicketUnread(token) {
    const [unread, setUnread] = useState(null);
    const requestRef = useRef(null);

    const refresh = useCallback(() => {
        if (!token || getTabToken() !== token) return;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        api.get('/tickets/unread', { signal: controller.signal, retry: 0, fallback: '读取工单提醒失败' })
            .then(result => {
                if (!controller.signal.aborted && getTabToken() === token) {
                    setUnread({ token, count: Math.max(0, Number(result?.total) || 0) });
                }
            })
            .catch(() => { /* Keep the latest count for this session when polling fails. */ })
            .finally(() => {
                if (requestRef.current === controller) requestRef.current = null;
            });
    }, [token]);

    useEffect(() => {
        if (!token) return undefined;
        refresh();
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') refresh();
        }, POLL_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            requestRef.current?.abort();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [token, refresh]);

    return { count: unread && unread.token === token ? unread.count : 0, refresh };
}
