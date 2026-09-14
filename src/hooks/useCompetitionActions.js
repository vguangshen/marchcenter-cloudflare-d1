import { useRef, useState } from 'react';
import { api } from '../utils/api';
import { confirmAction, notify } from '../utils/uiFeedback';
import { renderLaunchWindow } from '../utils/launchWindow';

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
    setStudentAccountsByCard
}) {
    const [createPanel, setCreatePanel] = useState(EMPTY_PANEL);
    const [creatingStudentCardId, setCreatingStudentCardId] = useState(null);
    const [deletingStudentKey, setDeletingStudentKey] = useState(null);
    const [classActionKey, setClassActionKey] = useState(null);
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

    const handleDeleteClass = async (link) => {
        if (!token || classActionKey) return;
        setClassActionKey(`remove:${link.id}`);
        try {
            const data = await api.post('/sso/class/remove', { competitionId: link.id }, {
                fallback: '删除班级失败', retry: 0, timeoutMs: 60_000
            });
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, classRemoved: 1 }
                : item));
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
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, classRemoved: 0 }
                : item));
            notify('已恢复，下次进入会自动重新建班', 'success');
        } catch (error) {
            notify(error.message || '恢复班级失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const handleRepairAccountReadiness = async (link) => {
        if (!token || classActionKey) return;
        const isJavaResync = link.ssoMethod === 'java';
        const platformLabel = isJavaResync ? 'Java' : '.NET';
        if (!await confirmAction({
            title: `修复 ${platformLabel} 平台登录`,
            message: '将立即重新同步教师、主学生和附加学生账号。这不会打开平台、删除班级或清除业务数据。',
            confirmText: '立即修复'
        })) return;
        setClassActionKey(`repair:${link.id}`);
        try {
            await api.post(`/sso/account-readiness/${link.id}/repair`, {}, {
                fallback: `${platformLabel} 登录修复失败`,
                retry: 0,
                timeoutMs: 150_000
            });
            setLinks(previous => previous.map(item => item.id === link.id
                ? { ...item, teacherReady: 1, studentReady: 1 }
                : item));
            const cardKey = String(link.id);
            setStudentAccountsByCard(previous => ({
                ...previous,
                [cardKey]: (previous[cardKey] || []).map(account => ({
                    ...account,
                    platformReady: 1
                }))
            }));
            notify(`${platformLabel} 账号同步完成，可再次尝试教师端或学生端登录`, 'success');
        } catch (error) {
            notify(error.message || '重新校验准备失败', 'error');
        } finally {
            setClassActionKey(null);
        }
    };

    const markAsExecuted = async (id) => {
        try {
            await api.post(`/competitions/${id}/complete`, {}, { fallback: '状态记录失败', retry: 0 });
            setLinks(previous => previous.map(card => card.id === id ? { ...card, has_executed: 1 } : card));
        } catch (error) {
            notify(error.message || '状态记录失败', 'warning');
        }
    };

    const handleOpenCompetition = async (link, loginRole = 'student', studentTarget = null) => {
        if (!token) {
            setCreatePanel({
                visible: true, step: 0, title: link.title, message: '',
                error: '请先登录后再进入系统', linkId: link.id
            });
            return;
        }
        const studentIndex = loginRole === 'expert'
            ? Number(studentTarget?.studentIndex ?? studentTarget?.rosterIndex ?? studentTarget ?? 1)
            : studentTarget;
        const requestKey = `${link.id}:${loginRole}:${studentIndex || ''}`;
        if (openingCompetitionRef.current.has(requestKey)) return;
        openingCompetitionRef.current.add(requestKey);
        setOpeningCompetitionKeys(previous => new Set(previous).add(requestKey));
        let launchWindow = null;
        const openLaunchWindow = () => {
            const opened = window.open('about:blank', '_blank');
            if (!opened) throw new Error('浏览器阻止了新窗口，请允许本站打开弹窗后重试');
            try { opened.opener = null; } catch { /* best effort */ }
            try {
                renderLaunchWindow(opened, {
                    title: loginRole === 'expert' ? '正在进入评委端' : '正在进入竞赛平台',
                    message: loginRole === 'expert'
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
            if (link.ssoMethod || link.ssoConfigId) {
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
                if (!accountAlreadyReady || needsPasswordRestore) {
                    setCreatePanel({
                        visible: true, step: 1, title: link.title,
                        message: '正在检查平台连接…', error: null, linkId: link.id
                    });
                }
                const data = await api.stream('/sso/execute/stream', {
                    method: 'POST',
                    body: JSON.stringify({
                        competitionId: link.id,
                        method: link.ssoMethod || null,
                        configId: link.ssoConfigId || null,
                        context: { loginRole, studentIndex }
                    }),
                    timeoutMs: 90_000,
                    fallback: 'SSO 执行失败',
                    retry: 0
                }, ({ event, data: eventData }) => {
                    if (event !== 'stage' || !eventData?.stage) return;
                    const step = { check_connection: 1, check_class: 2, create_account: 3, prepare_entry: 4 }[eventData.stage];
                    if (!step) return;
                    setCreatePanel(previous => ({
                        ...previous, step, message: eventData.message || previous.message
                    }));
                });
                if (!data?.success || (!data.redirectUrl && !data.postForm)) throw new Error('平台接口未返回有效的登录地址');
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
                if (data.postForm) submitPostForm(launchWindow, data.postForm);
                else navigateLaunchWindow(launchWindow, data.redirectUrl);
                // The workflow-status write is bookkeeping only. Start the
                // vendor navigation first so D1 latency cannot delay the
                // teacher/student entering the platform.
                void markAsExecuted(link.id);
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
            setCreatePanel(previous => ({
                ...previous,
                visible: true,
                step: previous.linkId === link.id ? previous.step || 1 : 1,
                title: link.title,
                message: previous.linkId === link.id ? previous.message : '',
                error: `SSO 失败：${error.message}`,
                linkId: link.id
            }));
        } finally {
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
        openingCompetitionKeys,
        handleCreateStudent,
        handleDeleteStudent,
        handleDeleteClass,
        handleInitializeClass,
        handleRepairAccountReadiness,
        handleRestoreClass,
        handleUnsupportedClassDelete: () => notify('该接入方式不支持删除班级', 'warning'),
        handleOpenCompetition,
        handleRequestManualCredential,
        handleOpenAdminEntry
    };
}
