import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../utils/api';
import { confirmAction, notify } from '../utils/uiFeedback';

const EMPTY_CARD_STATES = Object.freeze({});
const RESULT_STATUSES = new Set(['in_progress', 'scoring', 'completed']);
const RETURN_SCORE_DELAYS_MS = [3000, 8000, 20_000, 40_000];

function taskBinding(link) {
    return JSON.stringify([link.ssoMethod, link.ssoConfigId, link.url,
        link.paasV2SoftwareUnique, link.paasV2PlugFlag, link.paasV2AnswerType]);
}

function stopReturnPolling(session, cardId) {
    const poll = session.returnPolls.get(cardId);
    if (!poll) return;
    window.clearTimeout(poll.timer);
    session.returnPolls.delete(cardId);
}

export function useAgentTaskResults({ token, userId, links, setLinks, fetchLinks }) {
    const session = useMemo(() => ({
        enabled: Boolean(token && userId != null), operations: new Map(), returnPolls: new Map(), lastLaunch: null
    }), [token, userId]);
    const [scoreState, setScoreState] = useState({ session: null, cards: EMPTY_CARD_STATES });
    const isCurrentSession = useCallback(() => (
        session.enabled && localStorage.getItem('authToken') === token
    ), [session, token]);

    const updateCardState = useCallback((cardId, binding, patch) => {
        setScoreState(previous => {
            const cards = previous.session === session ? previous.cards : EMPTY_CARD_STATES;
            const prior = cards[cardId]?.binding === binding ? cards[cardId] : null;
            return { session, cards: { ...cards, [cardId]: { ...prior, binding, ...patch } } };
        });
    }, [session]);

    const refreshAgentTaskScore = useCallback((link) => {
        const cardId = link.id;
        if (!isCurrentSession()) return;
        const binding = taskBinding(link);
        const pending = session.operations.get(cardId);
        if (pending) return pending.binding === binding ? pending.promise : undefined;
        const controller = new AbortController();
        const operation = { controller, type: 'score', binding };
        const isActive = () => session.operations.get(cardId) === operation && isCurrentSession();
        session.operations.set(cardId, operation);
        updateCardState(cardId, binding, { loading: true, error: '' });
        operation.promise = (async () => {
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
                if (!isActive()) return;
                if (result.status !== 'scoring') stopReturnPolling(session, cardId);
                updateCardState(cardId, binding, { result, loading: false });
                return result;
            } catch (error) {
                if (isActive()) {
                    stopReturnPolling(session, cardId);
                    updateCardState(cardId, binding, { loading: false, error: error.message || '成绩暂时无法查询' });
                }
            } finally {
                if (session.operations.get(cardId) === operation) session.operations.delete(cardId);
            }
        })();
        return operation.promise;
    }, [isCurrentSession, session, updateCardState]);

    const refreshReturnedAgentTask = useCallback((link) => {
        const cardId = link.id;
        if (!isCurrentSession() || session.returnPolls.has(cardId)) return;
        const poll = { binding: taskBinding(link), timer: null, attempt: 0 };
        session.returnPolls.set(cardId, poll);
        const check = async () => {
            if (!isCurrentSession()) {
                stopReturnPolling(session, cardId);
                return;
            }
            const result = await refreshAgentTaskScore(link);
            if (session.returnPolls.get(cardId) !== poll) return;
            const delay = RETURN_SCORE_DELAYS_MS[poll.attempt];
            if (result?.status !== 'scoring' || delay === undefined) {
                stopReturnPolling(session, cardId);
                return;
            }
            poll.attempt += 1;
            poll.timer = window.setTimeout(check, delay);
        };
        void check();
    }, [isCurrentSession, refreshAgentTaskScore, session]);

    const trackAgentTaskReturn = useCallback((link) => {
        if (isCurrentSession()) session.lastLaunch = link;
    }, [isCurrentSession, session]);

    useEffect(() => {
        const refreshOnReturn = () => {
            if (!session.lastLaunch || document.visibilityState === 'hidden') return;
            const link = session.lastLaunch;
            session.lastLaunch = null;
            refreshReturnedAgentTask(link);
        };
        window.addEventListener('focus', refreshOnReturn);
        document.addEventListener('visibilitychange', refreshOnReturn);
        return () => {
            window.removeEventListener('focus', refreshOnReturn);
            document.removeEventListener('visibilitychange', refreshOnReturn);
            for (const { controller } of session.operations.values()) controller.abort();
            session.operations.clear();
            for (const cardId of session.returnPolls.keys()) stopReturnPolling(session, cardId);
            session.lastLaunch = null;
        };
    }, [refreshReturnedAgentTask, session]);

    const bindings = useMemo(() => new Map(links.filter(link => link.ssoMethod === 'paasV2')
        .map(link => [link.id, taskBinding(link)])), [links]);
    useEffect(() => {
        for (const [id, operation] of session.operations) {
            if (bindings.get(id) === operation.binding) continue;
            operation.controller.abort();
            session.operations.delete(id);
        }
        for (const [id, poll] of session.returnPolls) {
            if (bindings.get(id) !== poll.binding) stopReturnPolling(session, id);
        }
        if (session.lastLaunch && bindings.get(session.lastLaunch.id) !== taskBinding(session.lastLaunch)) session.lastLaunch = null;
    }, [bindings, session]);

    const handleResetAgentTask = async (link) => {
        if (!isCurrentSession()) return notify('请先登录', 'warning');
        if (!await confirmAction({
            title: '重置智能体任务',
            message: '该操作会清空当前账号在大渔平台的此任务进度和得分，重置后需要重新开始。确定继续吗？',
            confirmText: '确认重置'
        })) return;
        const cardId = link.id;
        const binding = taskBinding(link);
        const pending = session.operations.get(cardId);
        if (!isCurrentSession() || pending?.type === 'reset') return;
        if (session.lastLaunch?.id === cardId) session.lastLaunch = null;
        stopReturnPolling(session, cardId);
        pending?.controller.abort();
        const controller = new AbortController();
        const operation = { controller, type: 'reset', binding };
        const isActive = () => session.operations.get(cardId) === operation && isCurrentSession();
        session.operations.set(cardId, operation);
        updateCardState(cardId, binding, { loading: false, error: '', resetting: true });
        try {
            await api.post('/paas-v2/reset', { competitionId: cardId }, {
                fallback: '重置任务失败', signal: controller.signal, retry: 0
            });
            if (!isActive()) return;
            updateCardState(cardId, binding, { result: null });
            setLinks(previous => previous.map(card => card.id === cardId
                ? { ...card, has_executed: 0, agentResult: null }
                : card));
            await fetchLinks({ animate: false });
            if (isActive()) notify('已重置任务', 'success');
        } catch (error) {
            if (isActive()) notify(error.message || '重置任务失败', 'error');
        } finally {
            if (isActive()) updateCardState(cardId, binding, { resetting: false });
            if (session.operations.get(cardId) === operation) session.operations.delete(cardId);
        }
    };

    const agentScoreStates = useMemo(() => {
        if (scoreState.session !== session) return EMPTY_CARD_STATES;
        return Object.fromEntries([...bindings].flatMap(([id, binding]) => {
            const state = scoreState.cards[id];
            return state?.binding === binding ? [[id, state]] : [];
        }));
    }, [bindings, scoreState, session]);

    return {
        agentScoreStates,
        refreshAgentTaskScore,
        refreshReturnedAgentTask,
        trackAgentTaskReturn,
        handleResetAgentTask
    };
}
