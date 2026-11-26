import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';

const EMPTY_PAGE = { users: [], loading: false, error: '', hasMore: false };

export function usePagedUsers(queryString, { enabled, revision = 0 }) {
    const scope = useMemo(() => ({ queryString, enabled }), [queryString, enabled]);
    const [result, setResult] = useState(EMPTY_PAGE);
    const requestNext = useRef(null);
    const lastSuccess = useRef(null);

    useEffect(() => {
        if (!scope.enabled) {
            lastSuccess.current = null;
            return;
        }
        const controller = new AbortController();
        const previous = lastSuccess.current?.scope === scope ? lastSuccess.current : null;
        // Keep the existing rows mounted until every previously loaded page is refreshed.
        const refreshThrough = previous?.page || 1;
        let page = 0;
        let busy = false;
        let hasMore = true;
        let users = previous?.users || [];
        const load = async () => {
            if (busy || !hasMore || controller.signal.aborted) return;
            busy = true;
            setResult({ scope, users, loading: true, error: '', hasMore: false });
            try {
                const query = new URLSearchParams(scope.queryString);
                query.set('pageSize', '50');
                const fresh = new Map(page ? users.map(user => [user.id, user]) : []);
                let next = page + 1;
                let totalPages;
                do {
                    query.set('page', String(next));
                    const data = await api.get(`/users?${query}`, { signal: controller.signal, retry: 0, fallback: '账号列表读取失败' });
                    if (controller.signal.aborted) return;
                    for (const user of data.users) fresh.set(user.id, user);
                    totalPages = data.totalPages;
                    next += 1;
                } while (next <= Math.min(refreshThrough, totalPages));
                page = next - 1;
                hasMore = page < totalPages;
                users = [...fresh.values()];
                lastSuccess.current = { scope, page, users };
                setResult({ scope, users, loading: false, error: '', hasMore });
            } catch (error) {
                if (!controller.signal.aborted) setResult({ scope, users, loading: false, error: error.message || '账号列表读取失败', hasMore: false });
            } finally {
                busy = false;
            }
        };
        requestNext.current = load;
        load();
        return () => {
            controller.abort();
            requestNext.current = null;
        };
    }, [scope, revision]);

    const current = result.scope === scope ? result : { ...EMPTY_PAGE, loading: enabled };
    const loadMore = () => requestNext.current?.();
    return { ...current, loadMore, retry: loadMore };
}
