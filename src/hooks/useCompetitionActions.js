import { useRef, useState } from 'react';
import { api } from '../utils/api';
import { confirmAction, notify } from '../utils/uiFeedback';
import { renderLaunchWindow } from '../utils/launchWindow';
import { SSO_LAUNCH_TIMEOUT_MS, SSO_REPAIR_TIMEOUT_MS, SSO_RESPONSE_GRACE_MS } from '../constants/ssoTiming.js';

const EMPTY_PANEL = Object.freeze({
    visible: false, step: 0, title: '', message: '', error: null, linkId: null, launchUrl: null
});

const ADMIN_ENTRY_LOAD_FALLBACK_MS = 4000;

function waitForAdminLoginResponse(launchWindow) {
    return new Promise(resolve => {
        let settled = false;
        let fallbackTimer = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
            try { launchWindow.removeEventListener('load', finish); } catch { /* cross-origin after login */ }
            resolve();
        };

        // The listener is attached while the popup is still same-origin. It
        // fires once the cross-origin native login response has fully loaded
        // and therefore after that platform has written its session cookie.
        launchWindow.addEventListener('load', finish, { once: true });
        fallbackTimer = window.setTimeout(finish, ADMIN_ENTRY_LOAD_FALLBACK_MS);
    });
}

export function useCompetitionActions({
    token,
    currentUser,
    setLinks,
    studentAccountsByCard,
    setStudentAccountsByCard,
    trackAgentTaskReturn,
    refreshAgentTaskScore,
    refreshCompetitionBindings
}) {
    const [createPanel, setCreatePanel] = useState(EMPTY_PANEL);
    const [creatingStudentCardId, setCreatingStudentCardId] = useState(null);
    const [deletingStudentKey, setDeletingStudentKey] = useState(null);
    const [classActionKey, setClassActionKey] = useState(null);
    const [repairFailures, setRepairFailures] = useState(null);
    const repairFailuresByCard = repairFailures?.token === token ? repairFailures?.cards : null;
    const [openingCompetitionKeys, setOpeningCompetitionKeys] = useState(() => new Set());
    const openingCompetitionRef = useRef(new Set());

    const handleCreateStudent = async (link) => {
        if (!token || creatingStudentCardId) return;
        setCreatingStudentCardId(link.id);
        try {
            const data = await api.post(`/sso/student-accounts/${link.id}`, {}, { fallback: '新增学生账号失败' });
            if (!data.success || !data.account) throw new Error('新增学生账号失败');
            const key = String(link.id);
            setStudentAccountsByCard(previous => ({
                ...previous,
                [key]: [...(previous[key] || []), data.account].sort((a, b) => a.studentIndex - b.studentIndex)
            }));
        } catch (error) {
            notify(`新增学生失败：${error.message}`, 'error');
        } finally {
            setCreatingStudentCardId(null);
        }
    };

    const handleDeleteStudent = async (link, account) => {
        const key = `${link.id}:${account.studentIndex}`;
        if (!token || deletingStudentKey) return;
        if (!await confirmAction({
            title: '删除学生账号',
            message: `确定删除学生账号 ${account.accountName}？\n该账号会同时从对应实训系统中删除或标记为已删除。`,
            confirmText: '删除'
        })) return;
        setDeletingStudentKey(key);
        try {
            const data = await api.delete(`/sso/student-accounts/${link.id}/${account.studentIndex}`, { fallback: '删除学生账号失败' });
            if (!data.success) throw new Error('删除学生账号失败');
            const cardKey = String(link.id);
            setStudentAccountsByCard(previous => ({
                ...previous,
                [cardKey]: (previous[cardKey] || []).filter(item => item.studentIndex !== account.studentIndex)
            }));
        } catch (error) {
            notify(`删除学生失败：${error.message}`, 'error');
        } finally {
            setDeletingStudentKey(null);
        }
    };

    const updateClassRemoval = (id, classRemoved) => {
        setLinks(previous => previous.map(item => item.id === id
            ? { ...item, classRemoved, teacherReady: 0, studentReady: 0 } : item));
        setStudentAccountsByCard(previous => previous[id]?.length ? {
            ...previous, [id]: previous[id].map(account => ({ ...account, platformReady: 0 }))
        } : previous);
    };

    const handleDeleteClass = async (link) => {
        if (!token || classActionKey) return;
        setClassActionKey(`remove:${link.id}`);
        try {
            const data = await api.post('/sso/class/remove', { competitionId: link.id }, {
                fallback: '删除班级失败', retry: 0, timeoutMs: 60_000
            });
            updateClassRemoval(link.id, 1);
            notify(data.deleted
                ? `班级 ${data.className || ''} 已从平台删除`
                : '平台班级不存在，卡片已标记为删除', 'success');
        } catch (error) {
            notify(error.message || '删除班级失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const handleInitializeClass = async (link) => {
        if (!token || classActionKey || !['admin', 'super_admin'].includes(currentUser?.role)) return;
        if (!await confirmAction({
            title: '初始化该系统',
            message: '该操作会清空此平台中的全部班级、账号和成绩数据，且无法恢复。确定继续吗？',
            confirmText: '初始化系统',
            danger: true
        })) return;
        setClassActionKey(`initialize:${link.id}`);
        try {
            const confirmation = await api.post('/sso/module/init/confirm', { competitionId: link.id }, {
                fallback: '申请初始化确认失败', retry: 0
            });
            if (!confirmation?.confirmToken) throw new Error('初始化确认令牌无效');
            await api.post('/sso/module/init', {
                competitionId: link.id,
                confirmToken: confirmation.confirmToken
            }, { fallback: '初始化系统失败', retry: 0, timeoutMs: 135_000 });
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, classRemoved: 1 }
                : item));
            notify('平台全部班级数据已初始化，卡片已变为虚影状态', 'success');
        } catch (error) {
            notify(error.message || '初始化系统失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const handleRestoreClass = async (link) => {
        if (!token || classActionKey) return;
        setClassActionKey(`restore:${link.id}`);
        try {
            await api.post('/sso/class/restore', { competitionId: link.id }, {
                fallback: '恢复班级失败', retry: 0, timeoutMs: 60_000
            });
            updateClassRemoval(link.id, 0);
            notify('已恢复，下次进入会自动重新建班', 'success');
        } catch (error) {
            notify(error.message || '恢复班级失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const handleRepairAccountReadiness = async (link) => {
        if (!token || classActionKey) return;
        const platformLabel = link.ssoMethod === 'java' ? 'Java' : link.ssoMethod === 'net' ? '.NET' : '竞赛';
        const targets = repairFailuresByCard?.[link.id];
        if (!await confirmAction({
            title: `修复 ${platformLabel} 平台登录`,
            message: targets ? `将重新同步上次失败的 ${targets.length} 个账号。` : '将重新同步教师、主学生和附加学生账号。',
            confirmText: targets ? '重试同步' : '立即修复'
        })) return;
        if (localStorage.getItem('authToken') !== token) return;
        setClassActionKey(`repair:${link.id}`);
        try {
            const result = await api.post(`/sso/account-readiness/${link.id}/repair`, targets ? { targets } : {}, {
                fallback: `${platformLabel} 登录修复失败`,
                retry: 0,
                timeoutMs: SSO_REPAIR_TIMEOUT_MS + SSO_RESPONSE_GRACE_MS
            });
            if (localStorage.getItem('authToken') !== token) return;
            const repaired = Array.isArray(result?.repaired) ? result.repaired : [];
            const failed = Array.isArray(result?.failed) ? result.failed : [];
            const teacherReady = repaired.some(target => target.loginRole === 'teacher');
            const studentIndexes = new Set(repaired.filter(target => target.loginRole === 'student').map(target => target.studentIndex));
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, teacherReady: teacherReady ? 1 : item.teacherReady, studentReady: studentIndexes.has(1) ? 1 : item.studentReady }
                : item));
            const cardKey = String(link.id);
            setStudentAccountsByCard(previous => ({
                ...previous,
                [cardKey]: (previous[cardKey] || []).map(account => studentIndexes.has(Number(account.studentIndex))
                    ? { ...account, platformReady: 1 } : account)
            }));
            setRepairFailures(previous => ({ token, cards: {
                ...(previous?.token === token ? previous.cards : {}),
                [link.id]: failed.length ? failed.map(({ loginRole, studentIndex }) => ({ loginRole, studentIndex })) : undefined
            } }));
            if (link.manualCredentialActive && link.restoreOriginalPasswordBeforeSso) void refreshCompetitionBindings?.();
            if (failed.length) {
                notify(`已同步 ${repaired.length} 个账号，${failed.length} 个待重试。可从系统维护重试失败账号`, 'warning');
            } else {
                notify(`${platformLabel} 账号同步完成`, 'success');
            }
        } catch (error) {
            if (localStorage.getItem('authToken') !== token) return;
            if (targets && error.status === 400) setRepairFailures(previous => ({ token, cards: { ...previous?.cards, [link.id]: undefined } }));
            notify(error.message || '重新校验准备失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const markAsExecuted = async (id, { agentTask = false } = {}) => {
        try {
            await api.post(`/competitions/${id}/complete`, {}, { fallback: '状态记录失败', retry: 0 });
        } catch (error) {
            if (localStorage.getItem('authToken') === token) notify(error.message || '状态记录失败', 'warning');
            if (!agentTask) return;
        }
        if (localStorage.getItem('authToken') !== token) return;
        setLinks(previous => previous.map(card => {
            if (card.id !== id) return card;
            const clearUncheckedScore = agentTask && Number(card.has_executed) !== 1 && card.agentResult?.status === 'in_progress';
            return { ...card, has_executed: 1, ...(clearUncheckedScore && { agentResult: null }) };
        }));
    };

    const handleOpenCompetition = async (link, loginRole = 'student', studentTarget = null, { scoreDetails = false, competitionEventId = null } = {}) => {
        if (!token) {
            if (competitionEventId) return false;
            setCreatePanel({
                visible: true, step: 0, title: link.title, message: '',
                error: '请先登录后再进入系统', linkId: link.id
            });
            return;
        }
        const studentIndex = loginRole === 'expert'
            ? Number(studentTarget?.studentIndex ?? studentTarget?.rosterIndex ?? studentTarget ?? 1)
            : studentTarget;
        const requestKey = competitionEventId || `${link.id}:${loginRole}:${studentIndex || ''}`;
        if (openingCompetitionRef.current.has(requestKey)) return;
        openingCompetitionRef.current.add(requestKey);
        setOpeningCompetitionKeys(previous => new Set(previous).add(requestKey));
        let launchWindow = null;
        let launchController;
        let windowMonitor;
        const eventEntryLabel = loginRole === 'teacher' ? '教师端' : '学生端';
        const openLaunchWindow = () => {
            const opened = window.open('about:blank', '_blank');
            if (!opened) throw new Error('浏览器阻止了新窗口，请允许本站打开弹窗后重试');
            try { opened.opener = null; } catch { /* best effort */ }
            try {
                renderLaunchWindow(opened, {
                    title: competitionEventId ? `正在打开${eventEntryLabel}` : scoreDetails ? '正在打开得分详情' : loginRole === 'expert' ? '正在进入评委端' : '正在进入竞赛平台',
                    message: competitionEventId ? '正在校验本次竞赛的班级和账号…' : scoreDetails ? '正在确认大渔工坊的任务状态…' : loginRole === 'expert'
                        ? '正在绑定所选学生并获取评委票据…'
                        : '正在同步账号并准备免密登录…',
                    tone: loginRole === 'expert' ? 'violet' : 'indigo'
                });
            } catch { /* about:blank 初始化是尽力而为 */ }
            return opened;
        };
        const navigateLaunchWindow = (opened, url) => {
            if (!opened || opened.closed) throw new Error('登录窗口已被关闭，请重试');
            opened.location.replace(url);
        };
        const submitPostForm = (opened, postForm) => {
            if (!opened || opened.closed) throw new Error('登录窗口已被关闭，请重试');
            const doc = opened.document;
            doc.body.replaceChildren();
            const form = doc.createElement('form');
            form.action = postForm.action;
            form.method = postForm.method || 'POST';
            form.style.display = 'none';
            for (const [name, value] of Object.entries(postForm.fields || {})) {
                const input = doc.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = String(value ?? '');
                form.appendChild(input);
            }
            doc.body.appendChild(form);
            form.submit();
        };
        const clearCreatePanel = () => setCreatePanel(previous => previous?.linkId === link.id
            ? EMPTY_PANEL
            : previous);

        try {
            if (loginRole === 'expert') {
                if (!['java', 'net'].includes(link.ssoMethod)) throw new Error('当前竞赛平台暂不支持评委端');
                    launchWindow = openLaunchWindow();
                    setCreatePanel({
                        visible: true, step: 1, title: link.title,
                        message: '正在准备该学生的评委入口…',
                        error: null, linkId: link.id
                    });
                const data = await api.post(`/sso/expert-accounts/${link.id}`, {
                    studentIndex: Number(studentIndex) > 0 ? Number(studentIndex) : 1
                }, {
                    timeoutMs: 150_000,
                    fallback: '评委入口准备失败',
                    retry: 0
                });
                if (!data?.success || !data.redirectUrl) throw new Error('平台接口未返回有效的评委登录地址');
                setLinks(previous => previous.map(item => item.id === link.id
                    ? { ...item, expertReady: 1 }
                    : item));
                clearCreatePanel();
                navigateLaunchWindow(launchWindow, data.redirectUrl);
                void markAsExecuted(link.id);
                return;
            }
            if (competitionEventId || link.ssoMethod || link.ssoConfigId) {
                const isAdditionalStudent = Number.isInteger(Number(studentIndex)) && Number(studentIndex) > 1;
                const accountAlreadyReady = isAdditionalStudent
                    ? (studentAccountsByCard[String(link.id)] || []).some(account => (
                        Number(account.studentIndex) === Number(studentIndex)
                        && Boolean(Number(account.platformReady))
                    ))
                    : loginRole === 'teacher' ? Boolean(link.teacherReady) : Boolean(link.studentReady);
                const manualCredentialEnabled = link.manualCredentialEnabled === true
                    || Number(link.manualCredentialEnabled) === 1;
                const needsPasswordRestore = Boolean(
                    manualCredentialEnabled && link.restoreOriginalPasswordBeforeSso && link.manualCredentialActive
                );
                launchWindow = openLaunchWindow();
                if (scoreDetails) {
                    const result = await refreshAgentTaskScore(link);
                    if (!result) throw new Error('暂时无法确认任务状态，请重试');
                    if (result.status !== 'completed') {
                        launchWindow.close();
                        notify(result.status === 'scoring' ? '任务正在评分，请稍后刷新得分' : '任务尚未完成，请继续任务', 'warning');
                        return;
                    }
                    if (launchWindow.closed) throw new Error('详情窗口已被关闭，请重试');
                }
                if (!competitionEventId && (!accountAlreadyReady || needsPasswordRestore)) {
                    setCreatePanel({
                        visible: true, step: 1, title: link.title,
                        message: '正在检查平台连接…', error: null, linkId: link.id
                    });
                }
                launchController = new AbortController();
                windowMonitor = window.setInterval(() => {
                    if (launchWindow.closed || localStorage.getItem('authToken') !== token) launchController.abort();
                }, 500);
                const data = await api.stream('/sso/execute/stream', {
                    method: 'POST',
                    body: JSON.stringify(competitionEventId ? { competitionId: link.id, competitionEventId } : {
                        competitionId: link.id,
                        method: link.ssoMethod || null,
                        configId: link.ssoConfigId || null,
                        context: { loginRole, studentIndex }
                    }),
                    signal: launchController.signal,
                    timeoutMs: SSO_LAUNCH_TIMEOUT_MS + SSO_RESPONSE_GRACE_MS,
                    fallback: 'SSO 执行失败',
                    retry: 0
                }, ({ event, data: eventData }) => {
                    if (competitionEventId || event !== 'stage' || !eventData?.stage) return;
                    const step = { check_connection: 1, check_class: 2, create_account: 3, prepare_entry: 4 }[eventData.stage];
                    if (!step) return;
                    setCreatePanel(previous => ({
                        ...previous, step, message: eventData.message || previous.message
                    }));
                });
                window.clearInterval(windowMonitor);
                if (localStorage.getItem('authToken') !== token) {
                    launchWindow.close();
                    if (!competitionEventId) clearCreatePanel();
                    return;
                }
                if (!data?.success || (!data.redirectUrl && !data.postForm)) throw new Error('平台接口未返回有效的登录地址');
                if (competitionEventId) {
                    if (data.postForm) submitPostForm(launchWindow, data.postForm);
                    else navigateLaunchWindow(launchWindow, data.redirectUrl);
                    return true;
                }
                if (!isAdditionalStudent) {
                    const readyField = loginRole === 'teacher' ? 'teacherReady' : 'studentReady';
                    setLinks(previous => previous.map(item => item.id === link.id
                        ? { ...item, [readyField]: 1, manualCredentialActive: data.passwordRestored ? 0 : item.manualCredentialActive }
                        : item));
                } else {
                    const cardKey = String(link.id);
                    setStudentAccountsByCard(previous => ({
                        ...previous,
                        [cardKey]: (previous[cardKey] || []).map(account => (
                            Number(account.studentIndex) === Number(studentIndex)
                                ? { ...account, platformReady: 1 }
                                : account
                        ))
                    }));
                }
                clearCreatePanel();
                if (data.passwordRestored) void refreshCompetitionBindings?.();
                if (data.postForm) submitPostForm(launchWindow, data.postForm);
                else navigateLaunchWindow(launchWindow, data.redirectUrl);
                if (link.ssoMethod === 'paasV2') {
                    if (Number(link.has_executed) === 1 || scoreDetails) trackAgentTaskReturn?.(link);
                    await markAsExecuted(link.id, { agentTask: true });
                } else {
                    void markAsExecuted(link.id);
                }
                return;
            }
            if (link.url) {
                launchWindow = openLaunchWindow();
                navigateLaunchWindow(launchWindow, link.url);
            }
        } catch (error) {
            if (launchWindow && !launchWindow.closed) {
                try { launchWindow.close(); } catch { /* already closed */ }
            }
            if (launchController?.signal.aborted) {
                if (!competitionEventId) clearCreatePanel();
                return;
            }
            if (competitionEventId) {
                if (localStorage.getItem('authToken') === token) notify(error.message || `进入${eventEntryLabel}失败，请重试`, 'error');
                return false;
            }
            setCreatePanel(previous => ({
                ...previous,
                visible: true,
                step: previous.linkId === link.id ? previous.step || 1 : 1,
                title: link.title,
                message: previous.linkId === link.id ? previous.message : '',
                error: `${scoreDetails ? '得分详情打开失败' : 'SSO 失败'}：${error.message}`,
                linkId: link.id
            }));
        } finally {
            window.clearInterval(windowMonitor);
            openingCompetitionRef.current.delete(requestKey);
            setOpeningCompetitionKeys(previous => {
                const next = new Set(previous);
                next.delete(requestKey);
                return next;
            });
        }
    };

    const handleRequestManualCredential = async (link, { reset = false } = {}) => {
        if (!token) throw new Error('请先登录后再查看账号密码');
        if (!(link.manualCredentialEnabled === true || Number(link.manualCredentialEnabled) === 1)) {
            throw new Error('该竞赛卡片未启用提取账号信息');
        }
        const data = reset
            ? await api.post('/sso/manual-credential', { competitionId: link.id }, { fallback: '读取账号密码失败', retry: 0 })
            : await api.get(`/sso/manual-credential/${link.id}`, { fallback: '读取账号密码失败', retry: 0 });
        if (!data.success) throw new Error('读取账号密码失败');
        if (reset && data.credential) {
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, manualCredentialActive: 1 }
                : item));
            if (link.restoreOriginalPasswordBeforeSso) void refreshCompetitionBindings?.();
        }
        return data.credential || null;
    };

    const handleOpenAdminEntry = async (link) => {
        const entryLabel = link.ssoMethod === 'java' ? 'Admin' : 'Root';
        if (!token || currentUser?.role !== 'super_admin') {
            notify(`仅超级管理员可使用 ${entryLabel} 自动登录`, 'error');
            return;
        }
        if (!['java', 'net'].includes(link.ssoMethod)) {
            notify('管理员自动登录仅适用于 Java 或 .NET 平台', 'error');
            return;
        }
        const requestKey = `${link.id}:admin-entry:`;
        if (openingCompetitionRef.current.has(requestKey)) return;

        const windowName = `marchcenter-admin-${link.id}-${Date.now()}`;
        const launchWindow = window.open('about:blank', windowName);
        if (!launchWindow) {
            notify('浏览器阻止了新窗口，请允许本站打开弹窗后重试', 'error');
            return;
        }
        try {
            renderLaunchWindow(launchWindow, {
                title: `正在进入 ${entryLabel} 后台`,
                message: '正在安全切换管理员身份，请稍候…',
                tone: 'amber'
            });
        } catch { /* about:blank initialization is best effort */ }

        openingCompetitionRef.current.add(requestKey);
        setOpeningCompetitionKeys(previous => new Set(previous).add(requestKey));
        try {
            const data = await api.post(`/sso/admin-entry/${link.id}/prepare`, {}, {
                fallback: `${entryLabel} 自动登录准备失败`, retry: 0
            });
            const preparation = data?.preparation;
            if (!data?.success || !preparation?.relayPath || !preparation?.redirectUrl) {
                throw new Error(`平台未返回有效的 ${entryLabel} 登录信息`);
            }
            const relayUrl = new URL(preparation.relayPath, window.location.href);
            const loginResponseLoaded = waitForAdminLoginResponse(launchWindow);
            launchWindow.location.replace(relayUrl.toString());

            // Replace the tiny native JSON result as soon as it finishes
            // loading. The fallback only protects browsers that suppress the
            // cross-origin popup load notification.
            await loginResponseLoaded;
            if (launchWindow.closed) throw new Error(`${entryLabel} 登录窗口已被关闭，请重试`);
            launchWindow.location = preparation.redirectUrl;
        } catch (error) {
            try { if (!launchWindow.closed) launchWindow.close(); } catch { /* best effort */ }
            notify(error.message || `${entryLabel} 自动登录失败`, 'error');
        } finally {
            openingCompetitionRef.current.delete(requestKey);
            setOpeningCompetitionKeys(previous => {
                const next = new Set(previous);
                next.delete(requestKey);
                return next;
            });
        }
    };

    return {
        createPanel,
        setCreatePanel,
        creatingStudentCardId,
        deletingStudentKey,
        classActionKey,
        repairFailuresByCard,
        openingCompetitionKeys,
        handleCreateStudent,
        handleDeleteStudent,
        handleDeleteClass,
        handleInitializeClass,
        handleRepairAccountReadiness,
        handleRestoreClass,
        handleOpenCompetition,
        handleRequestManualCredential,
        handleOpenAdminEntry
    };
}
