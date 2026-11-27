import { useEffect, useRef } from 'react';

const POLL_MS = 5_000;

export function useVisibleChatPolling(active, load, refreshKey) {
    const loadRef = useRef(load);
    loadRef.current = load;
    useEffect(() => {
        if (!active) return undefined;
        const controller = new AbortController();
        let pending = false;
        const refresh = async () => {
            if (pending || document.visibilityState !== 'visible') return;
            pending = true;
            try { await loadRef.current(controller.signal); } finally { pending = false; }
        };
        refresh();
        const timer = window.setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', refresh);
        return () => {
            controller.abort();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [active, refreshKey]);
}
