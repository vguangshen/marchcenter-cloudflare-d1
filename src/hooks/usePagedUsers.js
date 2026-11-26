import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';

const EMPTY_PAGE = { users: [], loading: false, error: '', hasMore: false };
const PAGE_SIZE = '50';

// Last loaded rows per query, so a list that has been prefetched or opened
// before renders at once and is then refreshed in the background.
const pageCache = new Map();
const inflightPrefetches = new Map();
const prefetchQueue = [];
let activePrefetches = 0;
const MAX_PARALLEL_PREFETCHES = 2;
// A copy this recent (and from the current list revision) is shown without
// fetching page one again when the list opens.
const FRESH_MS = 30_000;

async function fetchFirstPage(queryString, signal) {
    const query = new URLSearchParams(queryString);
    query.set('pageSize', PAGE_SIZE);
    query.set('page', '1');
    const data = await api.get(`/users?${query}`, { signal, retry: 0, fallback: '账号列表读取失败' });
    return { page: 1, users: data.users, hasMore: data.totalPages > 1 };
}

function runPrefetchQueue() {
    while (activePrefetches < MAX_PARALLEL_PREFETCHES && prefetchQueue.length) {
        const job = prefetchQueue.shift();
        activePrefetches += 1;
        job().finally(() => {
            activePrefetches -= 1;
            runPrefetchQueue();
        });
    }
}

/**
 * Warms the cache for a user list query. `urgent` (hover/focus on the
 * expander) jumps the queue; background prefetches run two at a time.
 */
export function prefetchUsers(queryString, { urgent = false, revision = 0 } = {}) {
    if (pageCache.get(queryString)?.revision === revision || inflightPrefetches.has(queryString)) return;
    let resolveJob;
    const done = new Promise(resolve => { resolveJob = resolve; });
    inflightPrefetches.set(queryString, done);
    const job = () => fetchFirstPage(queryString)
        .then(result => {
            // A list opened meanwhile may already hold a fresher copy.
            if ((pageCache.get(queryString)?.revision ?? -1) < revision) pageCache.set(queryString, { ...result, revision, fetchedAt: Date.now() });
        })
        .catch(() => {})
        .finally(() => { inflightPrefetches.delete(queryString); resolveJob(); });
    if (urgent) prefetchQueue.unshift(job);
    else prefetchQueue.push(job);
    runPrefetchQueue();
}

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
        const previous = (lastSuccess.current?.scope === scope ? lastSuccess.current : null)
            || pageCache.get(scope.queryString)
            || null;
        // Keep the existing (or cached) rows mounted until every previously
        // loaded page is refreshed.
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
                query.set('pageSize', PAGE_SIZE);
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
                pageCache.set(scope.queryString, { page, users, hasMore, revision, fetchedAt: Date.now() });
                setResult({ scope, users, loading: false, error: '', hasMore });
            } catch (error) {
                if (!controller.signal.aborted) setResult({ scope, users, loading: false, error: error.message || '账号列表读取失败', hasMore: false });
            } finally {
                busy = false;
            }
        };
        requestNext.current = load;
        const applyFreshCache = () => {
            const cachedEntry = pageCache.get(scope.queryString);
            if (lastSuccess.current || cachedEntry?.revision !== revision || Date.now() - cachedEntry.fetchedAt >= FRESH_MS) return false;
            // Just prefetched: show it as loaded; "加载更多" continues from here.
            page = cachedEntry.page;
            hasMore = cachedEntry.hasMore;
            users = cachedEntry.users;
            lastSuccess.current = { scope, page, users };
            setResult({ scope, users, loading: false, error: '', hasMore });
            return true;
        };
        const pendingPrefetch = inflightPrefetches.get(scope.queryString);
        if (pendingPrefetch && !lastSuccess.current) {
            // A hover/background prefetch is already on its way: wait for it
            // instead of requesting the same page twice.
            setResult({ scope, users, loading: true, error: '', hasMore: false });
            pendingPrefetch.then(() => {
                if (!controller.signal.aborted && !applyFreshCache()) load();
            });
        } else if (!applyFreshCache()) {
            load();
        }
        return () => {
            controller.abort();
            requestNext.current = null;
        };
    }, [scope, revision]);

    // Before the effect runs, show cached rows rather than an empty "loading" state.
    const cached = enabled ? pageCache.get(queryString) : null;
    const current = result.scope === scope ? result : { ...EMPTY_PAGE, users: cached?.users || [], loading: enabled };
    const loadMore = () => requestNext.current?.();
    return { ...current, loadMore, retry: loadMore };
}
