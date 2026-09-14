import React, { useState } from 'react';
import {
    Search, UserPlus, Shield, Smartphone, Globe, MapPin,
    Trash2, Ban, CheckCircle2, KeyRound, Mail, Copy, Eye, EyeOff, X
} from 'lucide-react';
import { PRIMARY_BTN, GLASS_INPUT } from '../../../constants/config';
import { api } from '../../../utils/api';
import { confirmAction, notify } from '../../../utils/uiFeedback';
import { useModalAccessibility } from '../../../hooks/useModalAccessibility';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';
import LoginLocationModal from './LoginLocationModal';

const ROLE_RANK = { super_admin: 3, admin: 2, teacher: 1, student: 0, user: 0 };
const ROLE_META = {
    super_admin: { label: '超级管理员', subtitle: 'Super Administrator', avatar: 'bg-gradient-to-br from-amber-400 to-yellow-600', badge: 'bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-700 border-amber-300' },
    admin: { label: '管理员', subtitle: 'Administrator', avatar: 'bg-gradient-to-br from-indigo-500 to-purple-600', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    teacher: { label: '教师', subtitle: 'Teacher', avatar: 'bg-gradient-to-br from-cyan-500 to-blue-600', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
    student: { label: '学生', subtitle: 'Student', avatar: 'bg-gradient-to-br from-emerald-400 to-teal-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    user: { label: '学生', subtitle: 'Student', avatar: 'bg-gradient-to-br from-emerald-400 to-teal-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
};

const UserManager = ({ users, currentUser, classes = [], onAdd, onDelete, onRefresh, onToggleStatus, onClassChange, onPermission, loading = false, loadError = '', onRetry, page = 1, total = 0, pageSize = 50, searchTerm = '', onSearchChange = () => {}, onPageChange = () => {} }) => {
    const [locationUser, setLocationUser] = useState(null);
    const [resetCredential, setResetCredential] = useState(null);
    const [showResetPassword, setShowResetPassword] = useState(false);
    const resetCredentialDialogRef = useModalAccessibility(
        Boolean(resetCredential),
        () => setResetCredential(null)
    );

    const safeUsers = Array.isArray(users) ? users : [];

    // 用户列表按服务端分页平铺展示，避免教师与学生落在不同页时出现漏人、
    // 重复或错误的班级展开结果。班级人数使用独立的班级聚合接口数据。
    const displayUsers = safeUsers;

    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

    const parseDevice = (info) => {
        try {
            if (!info) return { os: '-', browser: '-', res: '-' };
            const data = typeof info === 'string' ? JSON.parse(info) : info;
            const ua = data.userAgent || '';
            let os = 'Other';
            if (ua.includes('Android')) os = 'Android'; else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'; else if (ua.includes('Win')) os = 'Windows'; else if (ua.includes('Mac')) os = 'macOS'; else if (ua.includes('Linux')) os = 'Linux';
            let browser = 'Other';
            if (ua.includes('Edg/')) browser = 'Edge'; else if (ua.includes('Chrome')) browser = 'Chrome'; else if (ua.includes('Firefox')) browser = 'Firefox'; else if (ua.includes('Safari')) browser = 'Safari';
            return { os, browser, res: data.screenResolution || '-' };
        } catch (e) { return { os: 'Unknown', browser: 'Unknown', res: '-' }; }
    };

    const handleResetPassword = async (user) => {
        if (!await confirmAction({
            title: '重置登录密码',
            message: `将用户「${user.username}」的密码重置为 123456，并立即撤销旧登录。用户登录后会收到修改密码提醒。`,
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

    return (
        <div className="animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h2 className="text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <UserPlus className="w-6 h-6 text-indigo-600" /> 用户管理
                        <span className="text-sm font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{total}</span>
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">查看用户状态、重置密码及管理权限。</p>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="搜索用户名 / 邮箱 / IP..." className={`w-full pl-9 pr-4 py-2 rounded-xl text-sm font-bold outline-none border border-transparent focus:border-indigo-500 transition-all ${GLASS_INPUT}`} value={searchTerm} onChange={(e) => onSearchChange(e.target.value)} />
                    </div>
                    <button onClick={onAdd} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center shadow-lg hover:shadow-xl transition-all ${PRIMARY_BTN}`}><UserPlus className="w-4 h-4 mr-2" /> 新增账号</button>
                    <button onClick={onDelete} className="px-4 py-2 rounded-xl text-sm font-bold flex items-center bg-white border border-slate-200 text-red-500 hover:bg-red-50 hover:border-red-100 transition-all"><Trash2 className="w-4 h-4 mr-2" /> 批量删除</button>
                </div>
            </div>

            <div className="mb-4 space-y-2">
                <LoadErrorNotice message={loadError} onRetry={onRetry} />
                {loading && <div className="text-xs font-bold text-slate-400">正在读取用户列表…</div>}
            </div>

            <div className="mb-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                <div className="text-sm font-black text-indigo-900">安全密码重置</div>
                <p className="mt-1 text-xs text-indigo-700/80">密码统一重置为 123456 并立即撤销旧会话；用户可继续登录，未修改时每次登录都会收到安全提醒。</p>
            </div>

            {/* Table */}
            <div className="bg-white/90 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-xs uppercase tracking-wider text-slate-500 font-bold">
                                <th className="p-4 w-16 text-center">头像</th>
                                <th className="p-4">用户概览</th>
                                <th className="p-4">网络与状态</th>
                                <th className="p-4">设备指纹</th>
                                <th className="p-4">系统权限</th>
                                <th className="p-4 text-right">管理操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {displayUsers.map(user => {
                                const device = parseDevice(user.device_info);
                                const lastActiveTime = user.last_active_time || user.last_login_time;
                                const isOnline = lastActiveTime && (Date.now() - new Date(lastActiveTime).getTime()) < 5 * 60 * 1000;
                                const roleMeta = ROLE_META[user.role] || ROLE_META.student;
                                const isSelf = currentUser && user.id === currentUser.id;
                                const canManage = !isSelf && (ROLE_RANK[currentUser?.role] ?? -1) > (ROLE_RANK[user.role] ?? 0);

                                return (
                                    <tr key={user.id} className="group hover:bg-indigo-50/30 dark:hover:bg-slate-800/30 transition-colors">
                                        <td className="p-4 text-center">
                                            <div className={`w-10 h-10 rounded-full mx-auto flex items-center justify-center text-sm font-black text-white shadow-md ${roleMeta.avatar}`}>
                                                {user.username ? user.username.substring(0, 2).toUpperCase() : '??'}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="font-bold text-slate-800 dark:text-white">{user.username}</div>
                                            <div className="text-xs text-slate-400 font-mono mt-0.5">{roleMeta.subtitle}</div>
                                            <div className="mt-1 flex max-w-[240px] items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400" title={user.email || '未绑定邮箱'}>
                                                <Mail className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{user.email || '未绑定邮箱'}</span>
                                            </div>
                                            {user.role === 'teacher' && user.class_id && (
                                                <div className="mt-1 inline-flex items-center gap-1 rounded-lg border border-cyan-100 bg-cyan-50 px-2 py-1 text-[10px] font-bold text-cyan-700">
                                                    {user.class_name || user.username}
                                                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] text-cyan-600">
                                                        {classes.find(item => Number(item.id) === Number(user.class_id))?.studentCount ?? 0} 名学生
                                                    </span>
                                                </div>
                                            )}
                                            {['student', 'user'].includes(user.role) && (
                                                <div className={`mt-1 inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold ${user.class_name ? 'bg-cyan-50 text-cyan-700 border border-cyan-100' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                                                    班级：{user.class_name || '未分配'}
                                                </div>
                                            )}
                                            {['super_admin', 'admin'].includes(currentUser?.role) && ['student', 'user'].includes(user.role) && classes.length > 0 && (
                                                <select
                                                    className="mt-1 block max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 outline-none focus:border-cyan-400"
                                                    value={user.class_id || ''}
                                                    onChange={e => onClassChange(user, e.target.value)}
                                                >
                                                    <option value="" disabled>选择班级</option>
                                                    {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                                </select>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-slate-300'}`} />
                                                <span className={`text-xs font-bold ${isOnline ? 'text-emerald-600' : 'text-slate-400'}`}>{isOnline ? '在线' : '离线'}</span>
                                            </div>
                                            {user.last_login_ip ? <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-500 font-mono"><Globe className="w-3 h-3" /> {user.last_login_ip}</div> : <span className="text-[10px] text-slate-300">无记录</span>}
                                            {(user.last_city || user.last_latitude != null) && (
                                                <button
                                                    type="button"
                                                    onClick={() => setLocationUser(user)}
                                                    className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 transition-colors hover:bg-indigo-100 dark:border-indigo-900/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                                                    title="查看登录位置"
                                                >
                                                    <MapPin className="w-3 h-3" /> {user.last_city || '查看位置'}
                                                </button>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><Smartphone className="w-4 h-4" /></div>
                                                <div>
                                                    <div className="text-xs font-bold text-slate-700">{device.os} <span className="text-slate-300">•</span> <span className="text-indigo-600">{device.browser}</span></div>
                                                    <div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1 rounded inline-block mt-0.5 border border-slate-100">{device.res}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col items-start gap-1.5">
                                                <span className={`role-badge role-badge-${user.role} px-2.5 py-1 rounded-lg border text-xs font-bold shadow-sm ${roleMeta.badge}`}>{roleMeta.label}</span>
                                                {canManage && ['teacher', 'student', 'user'].includes(user.role) && (
                                                    <button onClick={() => onPermission(user)} className="text-[10px] text-indigo-500 hover:underline flex items-center gap-1 border border-indigo-100 px-2 py-1 rounded hover:bg-indigo-50"><Shield className="w-3 h-3" /> 权限配置</button>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end items-center gap-2">

                                                {canManage && <button onClick={() => handleResetPassword(user)} className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-all border border-transparent hover:border-amber-200" title="重置密码">
                                                    <KeyRound className="w-4 h-4" />
                                                </button>}

                                                <div className="w-px h-4 bg-slate-200 mx-1"></div>

                                                {canManage && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onToggleStatus(user)}
                                                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border p-0 transition-all ${user.is_disabled ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-white text-red-500 border-slate-200 hover:border-red-200 hover:bg-red-50'}`}
                                                        title={user.is_disabled ? '启用用户' : '禁用用户'}
                                                        aria-label={user.is_disabled ? `启用用户 ${user.username}` : `禁用用户 ${user.username}`}
                                                    >
                                                        {user.is_disabled ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {total > pageSize && (
                    <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 px-4 py-3">
                        <span className="text-xs font-bold text-slate-500">共 {total} 人</span>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                disabled={page <= 1}
                                onClick={() => onPageChange(page - 1)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-300 hover:text-indigo-600"
                            >
                                上一页
                            </button>
                            <span className="text-xs font-bold text-slate-500">第 {page} / {totalPages} 页</span>
                            <button
                                type="button"
                                disabled={page >= totalPages}
                                onClick={() => onPageChange(page + 1)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-300 hover:text-indigo-600"
                            >
                                下一页
                            </button>
                        </div>
                    </div>
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
                        <p className="mt-1 text-xs leading-5 text-slate-500"><strong>{resetCredential.username}</strong> 的登录密码已重置；用户登录后会收到修改密码提醒，但可稍后处理。</p>
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
