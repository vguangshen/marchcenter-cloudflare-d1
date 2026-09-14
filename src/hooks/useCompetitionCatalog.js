import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../utils/api';

export function useCompetitionCatalog({ token, currentUser, revealEnabled = true }) {
    const [links, setLinks] = useState([]);
    const [linksPhase, setLinksPhase] = useState('loading');
    const [linksLoadError, setLinksLoadError] = useState('');
    const [studentAccountsByCard, setStudentAccountsByCard] = useState({});
    const [studentAccountsLoadError, setStudentAccountsLoadError] = useState('');
    const hasLinksRef = useRef(false);
    const linksRequestRef = useRef({ id: 0, controller: null });
    const accountsRequestRef = useRef({ id: 0, controller: null });

    useEffect(() => {
        hasLinksRef.current = links.length > 0;
    }, [links.length]);

    const fetchLinks = useCallback(async ({ animate = !hasLinksRef.current } = {}) => {
        linksRequestRef.current.controller?.abort();
        const requestId = linksRequestRef.current.id + 1;
        const controller = new AbortController();
        linksRequestRef.current = { id: requestId, controller };
        if (!token || !currentUser) {
            setLinks([]);
            setLinksLoadError('');
            setLinksPhase('ready');
            return;
        }

        const shouldAnimate = animate && revealEnabled;
        if (animate) setLinksPhase('loading');
        setLinksLoadError('');
        try {
            const data = await api.get('/competitions', {
                fallback: '竞赛卡片读取失败', signal: controller.signal
            });
            if (linksRequestRef.current.id !== requestId) return;
            setLinks(Array.isArray(data) ? data : []);
            setLinksPhase(shouldAnimate ? 'revealing' : 'ready');
        } catch (error) {
            if (error?.name === 'AbortError' || linksRequestRef.current.id !== requestId) return;
            setLinksLoadError(error.message || '竞赛卡片暂时没有加载成功，请检查网络后重试');
            setLinksPhase('error');
        }
    }, [currentUser, revealEnabled, token]);

    const completeLinksReveal = useCallback(() => {
        setLinksPhase(previous => previous === 'revealing' ? 'ready' : previous);
    }, []);

    const fetchStudentAccounts = useCallback(async () => {
        accountsRequestRef.current.controller?.abort();
        const requestId = accountsRequestRef.current.id + 1;
        const controller = new AbortController();
        accountsRequestRef.current = { id: requestId, controller };
        if (!token) {
            setStudentAccountsByCard({});
            setStudentAccountsLoadError('');
            return;
        }
        setStudentAccountsLoadError('');
        try {
            const rows = await api.get('/sso/student-accounts', {
                fallback: '学生账号读取失败', signal: controller.signal
            });
            if (accountsRequestRef.current.id !== requestId) return;
            const grouped = (Array.isArray(rows) ? rows : []).reduce((result, account) => {
                const key = String(account.competitionId);
                if (!result[key]) result[key] = [];
                result[key].push(account);
                return result;
            }, {});
            setStudentAccountsByCard(grouped);
        } catch (error) {
            if (error?.name === 'AbortError' || accountsRequestRef.current.id !== requestId) return;
            setStudentAccountsLoadError(error.message || '学生账号读取失败，请重试');
        }
    }, [token]);

    const resetCompetitionCatalog = useCallback(() => {
        linksRequestRef.current.controller?.abort();
        accountsRequestRef.current.controller?.abort();
        setLinks([]);
        setLinksLoadError('');
        setLinksPhase('ready');
        setStudentAccountsByCard({});
        setStudentAccountsLoadError('');
    }, []);

    useEffect(() => () => {
        linksRequestRef.current.controller?.abort();
        accountsRequestRef.current.controller?.abort();
    }, []);

    return {
        links,
        setLinks,
        linksPhase,
        linksLoadError,
        studentAccountsByCard,
        setStudentAccountsByCard,
        studentAccountsLoadError,
        fetchLinks,
        fetchStudentAccounts,
        completeLinksReveal,
        resetCompetitionCatalog
    };
}
