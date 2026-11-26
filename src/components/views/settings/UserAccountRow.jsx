import React, { useId, useState } from 'react';
import { ArrowRightLeft, Ban, CheckCircle2, ChevronDown, KeyRound, MapPin, Monitor, ShieldCheck, Trash2 } from 'lucide-react';

const ROLE_RANK = { super_admin: 3, admin: 2, teacher: 1, student: 0, user: 0 };
const ROLE_META = {
    super_admin: { label: '超级管理员', avatar: 'from-amber-400 to-amber-600', badge: 'border-amber-200 bg-amber-50 text-amber-700' },
    admin: { label: '管理员', avatar: 'from-indigo-400 to-violet-600', badge: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
    teacher: { label: '教师', avatar: 'from-sky-400 to-blue-600', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
    student: { label: '学生', avatar: 'from-emerald-400 to-teal-600', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
};
const ACTION_BUTTON = 'inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border bg-white px-3 py-1.5 text-xs font-bold transition-colors';

function readDevice(info) {
    let data = info;
    if (typeof info === 'string') {
        try { data = JSON.parse(info); } catch { return {}; }
    }
    const ua = data?.userAgent || '';
    const os = [['Android', /Android/], ['iOS', /iPhone|iPad|iPod/], ['Windows', /Win/], ['macOS', /Mac/], ['Linux', /Linux/]].find(([, pattern]) => pattern.test(ua))?.[0];
    const browser = [['Edge', /Edg(?:e|A|iOS)?\//], ['Firefox', /Firefox|FxiOS/], ['Chrome', /Chrome|CriOS/], ['Safari', /Safari/]].find(([, pattern]) => pattern.test(ua))?.[0];
    return { name: [os, browser].filter(Boolean).join(' · ') || (ua ? '其他设备' : ''), resolution: data?.screenResolution };
}

export default function UserAccountRow({ user, currentUser, classes, onLocation, onReset, onPermission, onToggleStatus, onClassChange, onDeleteAccount, deletingAccountId, children, nested = false }) {
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsId = useId();
    const role = ROLE_META[user.role] || ROLE_META.student;
    const isStudent = user.role === 'student' || user.role === 'user';
    const isSelf = Number(currentUser?.id) === Number(user.id);
    const canManage = !isSelf && (ROLE_RANK[currentUser?.role] ?? -1) > (ROLE_RANK[user.role] ?? 0);
    const canAssignClass = isStudent && ['super_admin', 'admin'].includes(currentUser?.role) && classes.length > 0;
    const device = readDevice(user.device_info);
    const lastActive = user.last_active_time || user.last_login_time;
    const online = lastActive && Date.now() - new Date(lastActive).getTime() < 5 * 60 * 1000;
    const status = user.is_disabled ? '已禁用' : online ? '在线' : '离线';

    return (
        <>
            <div className="user-account-grid user-account-row px-3 py-4 sm:px-4">
                <div className="user-account-identity flex min-w-0 items-start gap-2.5">
                    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-black text-white ${nested ? 'mt-0.5 h-8 w-8 text-xs' : 'h-9 w-9 text-sm'} ${role.avatar}`}>
                        {user.username?.slice(0, 2).toUpperCase() || '？'}
                    </span>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-bold text-slate-900 [overflow-wrap:anywhere]">{user.username}</span>
                            <span className={`role-badge role-badge-${user.role} whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-bold leading-tight ${role.badge}`}>{role.label}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">{user.email || '未绑定邮箱'}</p>
                        {children}
                        {isStudent && !nested && <p className="mt-1 text-xs text-slate-500">{user.class_name || '未分配班级'}</p>}
                    </div>
                </div>

                <div className="user-account-network flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-slate-600">
                        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${user.is_disabled ? 'bg-red-600 dark:bg-red-400' : online ? 'bg-emerald-600 dark:bg-emerald-400' : 'bg-slate-400'}`} />
                        {status}
                    </span>
                    {user.last_login_ip && <span className="font-mono text-xs text-slate-500 [overflow-wrap:anywhere]">{user.last_login_ip}</span>}
                    {(user.last_city || user.last_latitude != null) && (
                        <button type="button" onClick={() => onLocation(user)} title="查看登录位置" className="inline-flex max-w-full items-center gap-1 rounded py-0.5 text-left font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
                            <MapPin className="h-3.5 w-3.5 shrink-0" /><span className="[overflow-wrap:anywhere]">{user.last_city || '查看位置'}</span>
                        </button>
                    )}
                </div>

                <div className="user-account-device flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5 shrink-0" />
                        <span>{device.name || '暂无设备记录'}</span>
                    </span>
                    {device.resolution && <span className="max-w-full font-mono text-[11px] [overflow-wrap:anywhere]">{device.resolution}</span>}
                </div>

                <div className="user-account-manage justify-self-end">
                    {canManage ? (
                        <button type="button" aria-label={`管理 ${user.username}`} aria-expanded={actionsOpen} aria-controls={actionsId} onClick={() => setActionsOpen(!actionsOpen)}
                            className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 aria-expanded:border-indigo-300 aria-expanded:text-indigo-600">
                            管理 <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
                        </button>
                    ) : isSelf && <span className="whitespace-nowrap text-xs font-semibold text-slate-500">当前账号</span>}
                </div>
            </div>
            {canManage && <div id={actionsId} hidden={!actionsOpen}>
                {actionsOpen && (
                    <div role="group" aria-label={`${user.username} 的管理操作`} className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-3 py-3 sm:px-4 dark:border-slate-800">
                        {(isStudent || user.role === 'teacher') && <button type="button" onClick={() => onPermission(user)} className={`${ACTION_BUTTON} border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-600`}><ShieldCheck className="h-4 w-4" />权限配置</button>}
                        <button type="button" onClick={() => onReset(user)} className={`${ACTION_BUTTON} border-slate-200 text-slate-700 hover:border-amber-300 hover:text-amber-700`}><KeyRound className="h-4 w-4" />重置密码</button>
                        <button type="button" onClick={() => onToggleStatus(user)} className={`${ACTION_BUTTON} ${user.is_disabled ? 'border-emerald-200 text-emerald-700 dark:text-emerald-300' : 'border-red-200 text-red-600 dark:text-red-300'}`}>
                            {user.is_disabled ? <CheckCircle2 className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                            {user.is_disabled ? '启用用户' : '禁用用户'}
                        </button>
                        {onDeleteAccount && <button type="button" disabled={deletingAccountId != null} onClick={() => onDeleteAccount(user)}
                            className={`${ACTION_BUTTON} border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300`}>
                            <Trash2 className="h-4 w-4" />{deletingAccountId === user.id ? '正在删除…' : '删除此账号'}
                        </button>}
                        {canAssignClass && <label className={`${ACTION_BUTTON} relative max-w-full border-slate-200 pr-7 text-slate-700 hover:border-indigo-300 focus-within:border-indigo-400`}>
                            <ArrowRightLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
                            调整班级
                            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" />
                            <select aria-label={`调整 ${user.username} 的班级`} className="min-w-0 max-w-32 cursor-pointer appearance-none truncate bg-transparent text-xs font-bold text-indigo-600 outline-none dark:text-indigo-300" value={user.class_id || ''} onChange={e => onClassChange(user, e.target.value)}>
                                <option value="" disabled>选择班级</option>
                                {classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-slate-400" />
                        </label>}
                    </div>
                )}
            </div>}
        </>
    );
}
