import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { confirmAction, notify } from '../utils/uiFeedback';

const EMPTY_CARD_STATES = Object.freeze({});
const RESULT_STATUSES = new Set(['in_progress', 'scoring', 'completed']);

export function useAgentTaskResults({ token, userId, setLinks, fetchLinks }) {
    const session = useMemo(() => ({
        enabled: Boolean(token && userId != null), operations: new Map(), lastLaunch: null
    }), [token, userId]);
    const [scoreState, setScoreState] = useState({ session: null, cards: EMPTY_CARD_STATES });
    const isCurrentSession = useCallback(() => (
        session.enabled && localStorage.getItem('authToken') === token
    ), [session, token]);

    const updateCardState = useCallback((cardId, patch) => {
        setScoreState(previous => {
            const cards = previous.session === session ? previous.cards : EMPTY_CARD_STATES;
            return { session, cards: { ...cards, [cardId]: { ...cards[cardId], ...patch } } };
        });
    }, [session]);

    const refreshAgentTaskScore = useCallback(async (link) => {
        const cardId = link.id;
        if (!isCurrentSession() || session.operations.has(cardId)) return;
        const controller = new AbortController();
        const operation = { controller, type: 'score' };
        const isActive = () => session.operations.get(cardId) === operation && isCurrentSession();
        session.operations.set(cardId, operation);
        updateCardState(cardId, { loading: true, error: '' });
        try {
            const result = await api.post('/paas-v2/result', { competitionId: cardId }, {
                fallback: '成绩暂时无法查询',
                signal: controller.signal,
                timeoutMs: 60_000,
                retry: 0
            });
            if (!RESULT_STATUSES.has(result?.status)
                || (result.score !== null && !Number.isFinite(result.score))) {
                throw new Error('成绩返回异常，请稍后重试');
            }
            if (isActive()) updateCardState(cardId, { result, loading: false });
        } catch (error) {
            if (isActive()) updateCardState(cardId, { loading: false, error: error.message || '成绩暂时无法查询' });
        } finally {
            if (session.operations.get(cardId) === operation) session.operations.delete(cardId);
        }
    }, [isCurrentSession, session, updateCardState]);

    const trackAgentTaskReturn = useCallback((link) => {
        if (isCurrentSession()) session.lastLaunch = link;
    }, [isCurrentSession, session]);

    useEffect(() => {
        const refreshOnReturn = () => {
            if (!session.lastLaunch || document.visibilityState === 'hidden') return;
            const link = session.lastLaunch;
            session.lastLaunch = null;
            void refreshAgentTaskScore(link);
        };
        window.addEventListener('focus', refreshOnReturn);
        document.addEventListener('visibilitychange', refreshOnReturn);
        return () => {
            window.removeEventListener('focus', refreshOnReturn);
            document.removeEventListener('visibilitychange', refreshOnReturn);
            for (const { controller } of session.operations.values()) controller.abort();
            session.operations.clear();
            session.lastLaunch = null;
        };
    }, [refreshAgentTaskScore, session]);

    const handleResetAgentTask = async (link) => {
        if (!isCurrentSession()) return notify('请先登录', 'warning');
        if (!await confirmAction({
            title: '重置智能体任务',
            message: '该操作会清空当前账号在大渔平台的此任务进度和得分，重置后需要重新开始。确定继续吗？',
            confirmText: '确认重置'
        })) return;
        const cardId = link.id;
        const pending = session.operations.get(cardId);
        if (!isCurrentSession() || pending?.type === 'reset') return;
        if (session.lastLaunch?.id === cardId) session.lastLaunch = null;
        pending?.controller.abort();
        const controller = new AbortController();
        const operation = { controller, type: 'reset' };
        const isActive = () => session.operations.get(cardId) === operation && isCurrentSession();
        session.operations.set(cardId, operation);
        updateCardState(cardId, { loading: false, error: '' });
        try {
            await api.post('/paas-v2/reset', { competitionId: cardId }, {
                fallback: '重置任务失败', signal: controller.signal, retry: 0
            });
            if (!isActive()) return;
            updateCardState(cardId, { result: null });
            setLinks(previous => previous.map(card => card.id === cardId
                ? { ...card, has_executed: 0, agentResult: null }
                : card));
            await fetchLinks({ animate: false });
            if (isActive()) notify('已重置任务', 'success');
        } catch (error) {
            if (isActive()) notify(error.message || '重置任务失败', 'error');
        } finally {
            if (session.operations.get(cardId) === operation) session.operations.delete(cardId);
        }
    };

    return {
        agentScoreStates: scoreState.session === session ? scoreState.cards : EMPTY_CARD_STATES,
        refreshAgentTaskScore,
        trackAgentTaskReturn,
        handleResetAgentTask
    };
}
