import React, { useEffect, useId, useState } from 'react';
import { ChevronRight, Copy, Eye, EyeOff, KeyRound, Search, Trash2, UserPlus, Users, X } from 'lucide-react';
import { PRIMARY_BTN, GLASS_INPUT } from '../../../constants/config';
import { api } from '../../../utils/api';
import { confirmAction, notify } from '../../../utils/uiFeedback';
import { useModalAccessibility } from '../../../hooks/useModalAccessibility';
import { prefetchUsers, usePagedUsers } from '../../../hooks/usePagedUsers';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';
import LoginLocationModal from './LoginLocationModal';
import UserAccountRow from './UserAccountRow';

const SECONDARY_BUTTON = 'inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40';

function TeacherGroup({ teacher, appliedSearch, revision, rowProps, deletedAccountIds }) {
    const groupId = useId();
    const [manualExpansion, setManualExpansion] = useState(null);
    const count = Number(teacher.studentCount) || 0;
    const matched = appliedSearch ? Number(teacher.matchingStudentCount) || 0 : 0;
    const expanded = count > 0 && (manualExpansion ?? (matched > 0));
    const queryString = new URLSearchParams({ teacherId: String(teacher.id), search: matched ? appliedSearch : '' }).toString();
    const { users: members, loading, error, hasMore, loadMore, retry } = usePagedUsers(queryString, { enabled: expanded, revision });
    const students = members.filter(account => !deletedAccountIds.has(account.id));
    const listRevision = revision ?? 0;

    // Warm each teacher's student list in the background shortly after the
    // directory renders, so expanding shows the rows at once.
    useEffect(() => {
        if (!count) return undefined;
        const timer = window.setTimeout(() => prefetchUsers(queryString, { revision: listRevision }), 400);
        return () => window.clearTimeout(timer);
    }, [count, queryString, listRevision]);
    const prefetchNow = () => { if (count) prefetchUsers(queryString, { urgent: true, revision: listRevision }); };

    return (
        <>
            <UserAccountRow user={teacher} {...rowProps}>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {teacher.class_name && <span className="text-slate-500 [overflow-wrap:anywhere]">{teacher.class_name}</span>}
                    {count ? (
                        <button type="button" aria-expanded={expanded} aria-controls={groupId} onClick={() => setManualExpansion(!expanded)}
                            onPointerEnter={prefetchNow} onFocus={prefetchNow}
                            aria-label={`${expanded ? '收起' : '展开'} ${teacher.username} 的学生，${count} 名学生`}
                            className="inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-indigo-50 px-2 font-bold text-indigo-700 transition-colors hover:bg-indigo-100 dark:text-indigo-300">
                            <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                            {matched ? `匹配 ${matched} / ${count} 名学生` : `${count} 名学生`}
                        </button>
                    ) : <span className="text-slate-500">0 名学生</span>}
                </div>
            </UserAccountRow>
            <div id={groupId} hidden={!expanded} className="user-student-list border-t border-slate-100 dark:border-slate-800">
                {expanded && <>
                    {students.length > 0 && <ul aria-label={`${teacher.username} 的学生`} className="divide-y divide-slate-200/60 dark:divide-slate-700/60">
                        {students.map(student => <li key={student.id}><UserAccountRow user={student} nested {...rowProps} /></li>)}
                    </ul>}
                    {loading && !students.length && <p role="status" className="px-5 py-3 text-xs text-slate-500">正在读取学生账号…</p>}
                    {error && <div className="p-3"><LoadErrorNotice compact message={error} onRetry={retry} /></div>}
                    {!students.length && !loading && !error && <p className="px-5 py-3 text-xs text-slate-500">没有学生账号</p>}
                    {hasMore && !loading && !error && <div className="px-4 py-3"><button type="button" onClick={loadMore} className={SECONDARY_BUTTON}>加载更多学生</button></div>}
                </>}
            </div>
        </>
    );
}

const UserManager = ({
    users = [], currentUser, classes = [], onAdd, onDelete, onDeleteAccount, deletingAccountId, deletedAccountIds = new Set(), onRefresh, onToggleStatus, onClassChange, onPermission,
    loading = false, loadError = '', onRetry, page = 1, total = 0, totalPages = 1, appliedSearch = '', listRevision,
    searchTerm = '', onSearchChange, onPageChange
}) => {
    const [locationUser, setLocationUser] = useState(null);
    const [resetCredential, setResetCredential] = useState(null);
    const [showResetPassword, setShowResetPassword] = useState(false);
    const resetCredentialDialogRef = useModalAccessibility(
        Boolean(resetCredential),
        () => setResetCredential(null)
    );

    const handleResetPassword = async (user) => {
        if (!await confirmAction({
            title: '重置登录密码',
            message: `将用户「${user.username}」的密码重置为 123456，并按会话策略撤销旧登录。用户登录后必须先修改密码才能继续使用。`,
            confirmText: '重置'
        })) return;
        try {
            const data = await api.patch(`/users/${user.id}/reset-password`, {}, { fallback: '密码重置失败' });
            if (!data.resetPassword) throw new Error('服务器未返回重置密码');
            setResetCredential({ username: user.username, password: data.resetPassword });
            setShowResetPassword(false);
            await onRefresh?.();
        } catch (e) { notify(e.message || '网络错误', 'error'); }
    };

    const rowProps = {
        currentUser, classes, onLocation: setLocationUser, onReset: handleResetPassword,
        onPermission, onToggleStatus, onClassChange, onDeleteAccount, deletingAccountId
    };
    const visibleUsers = users.filter(account => !deletedAccountIds.has(account.id));

    return (
        <div className="user-directory animate-in fade-in duration-500">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex items-center gap-2.5">
                    <Users aria-hidden="true" className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                    <h2 className="text-2xl font-black text-slate-900">用户管理</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={onAdd} className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-bold ${PRIMARY_BTN}`}><UserPlus className="h-4 w-4" />新增账号</button>
                    <button type="button" onClick={onDelete} className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-bold text-red-600 transition-colors hover:border-red-200 hover:bg-red-50 dark:text-red-300"><Trash2 className="h-4 w-4" />批量删除</button>
                </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <label className="relative w-full max-w-md">
                    <span className="sr-only">搜索用户名、邮箱或 IP</span>
                    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="search" placeholder="搜索用户名、邮箱或 IP" className={`h-10 w-full rounded-xl pl-9 pr-3 text-sm ${GLASS_INPUT}`} value={searchTerm} onChange={e => onSearchChange(e.target.value)} />
                </label>
                <p role="status" className="text-xs font-semibold text-slate-500">{loading ? '正在读取账号…' : `${appliedSearch ? '匹配' : '共'} ${total} 个账号`}</p>
            </div>
            {loadError && <div className="mb-3"><LoadErrorNotice message={loadError} onRetry={onRetry} /></div>}

            <div className="user-directory-list rounded-2xl border border-slate-200 bg-white dark:border-slate-700">
                <div aria-hidden="true" className="user-account-grid user-account-head rounded-t-2xl border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
                    <span>账号与班级</span><span>登录状态与位置</span><span>登录设备</span><span className="text-right">账号操作</span>
                </div>
                <ul aria-label="用户账号" aria-busy={loading} className="divide-y divide-slate-200/70 dark:divide-slate-800">
                    {visibleUsers.map(user => <li key={user.id}>
                        {user.role === 'teacher'
                            ? <TeacherGroup key={appliedSearch} teacher={user} appliedSearch={appliedSearch} revision={listRevision} rowProps={rowProps} deletedAccountIds={deletedAccountIds} />
                            : <UserAccountRow user={user} {...rowProps} />}
                    </li>)}
                </ul>
                {!visibleUsers.length && !loadError && !loading && <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm font-semibold text-slate-500">
                    {appliedSearch ? '没有找到匹配的账号' : '暂无账号'}
                    {appliedSearch && <button type="button" onClick={() => onSearchChange('')} className={SECONDARY_BUTTON}>清除搜索</button>}
                </div>}
                {totalPages > 1 && (
                    <nav aria-label="账号分页" className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-3 py-3 text-xs font-semibold text-slate-600 sm:px-4">
                        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={SECONDARY_BUTTON}>上一页</button>
                        <span>第 {page} / {totalPages} 页</span>
                        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className={SECONDARY_BUTTON}>下一页</button>
                    </nav>
                )}
            </div>

            {locationUser && (
                <LoginLocationModal user={locationUser} onClose={() => setLocationUser(null)} />
            )}
            {resetCredential && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-5 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setResetCredential(null); }}>
                    <section ref={resetCredentialDialogRef} role="dialog" aria-modal="true" aria-labelledby="reset-credential-title" tabIndex={-1} className="relative w-full max-w-md rounded-[1.75rem] border border-amber-100 bg-white p-6 shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900">
                        <button type="button" onClick={() => setResetCredential(null)} aria-label="关闭" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700"><KeyRound className="h-6 w-6" /></div>
                        <h3 id="reset-credential-title" className="mt-4 text-lg font-black text-slate-900 dark:text-white">密码已重置</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-500"><strong>{resetCredential.username}</strong> 的登录密码已重置；用户登录后必须先修改密码。</p>
                        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2">
                            <code className="min-w-0 flex-1 truncate px-2 text-sm font-black tracking-wide text-amber-900">{showResetPassword ? resetCredential.password : '••••••'}</code>
                            <button type="button" onClick={() => setShowResetPassword(value => !value)} aria-label={showResetPassword ? '隐藏重置密码' : '显示重置密码'} className="grid h-9 w-9 place-items-center rounded-xl text-amber-700 transition hover:bg-white">{showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(resetCredential.password); notify('重置密码已复制', 'success'); } catch { notify('复制失败，请手动记录', 'error'); } }} aria-label="复制重置密码" className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-white shadow transition hover:bg-amber-600"><Copy className="h-4 w-4" /></button>
                        </div>
                        <button type="button" onClick={() => setResetCredential(null)} className="mt-5 h-11 w-full rounded-xl bg-slate-900 text-sm font-black text-white transition hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-500">完成</button>
                    </section>
                </div>
            )}
        </div>
    );
};

export default UserManager;
