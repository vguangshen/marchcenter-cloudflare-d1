import React, { useEffect, useRef, useState } from 'react';
import { Camera, Eye, EyeOff, ImagePlus, KeyRound, Loader2, Mail, Save, ShieldCheck, UserRound, X } from 'lucide-react';
import { api, changePassword as requestPasswordChange } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

const MAX_AVATAR_BYTES = 100 * 1024;
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/i;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const ROLE_LABELS = { super_admin: '超级管理员', admin: '管理员', teacher: '教师', student: '学生', user: '学生' };
const profileDraft = user => ({ avatarDataUrl: typeof user?.avatarDataUrl === 'string' ? user.avatarDataUrl : '' });

function avatarBytes(value) {
    const match = AVATAR_DATA_URL.exec(value);
    if (!match) return 0;
    const data = match[2];
    return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : Number(data.endsWith('=')));
}

export default function ProfileModal({ isOpen, onClose, onSaved, user }) {
    const [draft, setDraft] = useState(() => profileDraft(user));
    const [saving, setSaving] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [changingPassword, setChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState('');
    const [passwordSuccess, setPasswordSuccess] = useState('');
    const [error, setError] = useState('');
    const [refreshPending, setRefreshPending] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const userRef = useRef(user);
    userRef.current = user;
    const fileRef = useRef(null);
    const avatarRef = useRef(null);
    const busy = saving || changingPassword || refreshing;
    const close = () => { if (!busy) onClose?.(); };
    const dialogRef = useModalAccessibility(isOpen, close, { initialFocusRef: avatarRef });

    useEffect(() => {
        if (!isOpen) return;
        setDraft(profileDraft(userRef.current));
        setError('');
        setSaving(false);
        setCurrentPassword('');
        setPassword('');
        setConfirmation('');
        setShowPassword(false);
        setChangingPassword(false);
        setPasswordError('');
        setPasswordSuccess('');
        setRefreshPending(null);
    }, [isOpen, user?.id]);

    if (!isOpen) return null;
    const username = typeof user?.username === 'string' ? user.username : '';
    const displayName = username || 'mcgo.app 用户';
    const avatarInitial = Array.from(displayName.trim())[0]?.toUpperCase() || 'M';
    const changed = draft.avatarDataUrl !== profileDraft(user).avatarDataUrl;
    const setAvatar = value => { setDraft({ avatarDataUrl: value }); setError(''); };

    const synchronizeSavedUser = async (savedUser, closeAfterRefresh = false) => {
        try {
            await onSaved?.(savedUser);
            setRefreshPending(null);
            if (closeAfterRefresh) onClose?.();
            return true;
        } catch {
            setRefreshPending({ user: savedUser, closeAfterRefresh });
            return false;
        }
    };
    const retryRefresh = async () => {
        if (busy || !refreshPending) return;
        setRefreshing(true);
        try { await synchronizeSavedUser(refreshPending.user, refreshPending.closeAfterRefresh); }
        finally { setRefreshing(false); }
    };

    const chooseFile = event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        if (!AVATAR_TYPES.has(file.type)) { setError('仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片'); return; }
        if (file.size > MAX_AVATAR_BYTES) { setError('头像图片不能超过 100KB，请压缩后再上传'); return; }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '').trim();
            if (!AVATAR_DATA_URL.test(dataUrl) || avatarBytes(dataUrl) > MAX_AVATAR_BYTES) {
                setError('头像图片不能超过 100KB，请压缩后再上传');
                return;
            }
            setAvatar(dataUrl);
        };
        reader.onerror = () => setError('读取图片失败，请重新选择');
        reader.readAsDataURL(file);
    };

    const save = async event => {
        event.preventDefault();
        if (busy) return;
        if (draft.avatarDataUrl && (!AVATAR_DATA_URL.test(draft.avatarDataUrl) || avatarBytes(draft.avatarDataUrl) > MAX_AVATAR_BYTES)) {
            setError('头像图片不能超过 100KB，请重新选择');
            return;
        }
        setSaving(true);
        setError('');
        let result;
        try {
            result = await api.patch('/users/me/profile', { avatarDataUrl: draft.avatarDataUrl || null }, { fallback: '个人资料保存失败' });
        } catch (requestError) {
            setError(requestError.message || '个人资料保存失败，请稍后重试');
            setSaving(false);
            return;
        }
        notify('个人资料已保存', 'success');
        try { await synchronizeSavedUser(result?.user, true); }
        finally { setSaving(false); }
    };

    const changePassword = async () => {
        if (busy) return;
        setPasswordError('');
        setPasswordSuccess('');
        if (!user?.passwordChangeRecommended && !currentPassword) { setPasswordError('请输入当前密码'); return; }
        if (password.length < 6 || password.length > 128) { setPasswordError('新密码长度需为 6–128 位'); return; }
        if (password !== confirmation) { setPasswordError('两次输入的新密码不一致'); return; }
        if (currentPassword && currentPassword === password) { setPasswordError('新密码不能与当前密码相同'); return; }
        setChangingPassword(true);
        try {
            await requestPasswordChange({ currentPassword, password });
            setCurrentPassword('');
            setPassword('');
            setConfirmation('');
            setPasswordSuccess('登录密码已更新');
            notify('登录密码已更新', 'success');
        } catch (requestError) {
            setPasswordError(requestError.message || '修改密码失败，请稍后重试');
            setChangingPassword(false);
            return;
        }
        try { await synchronizeSavedUser({ ...user, passwordChangeRecommended: false }); }
        finally { setChangingPassword(false); }
    };

    return (
        <div className="mc-modal-backdrop mc-modal-backdrop--elevated animate-in fade-in duration-200">
            <form ref={dialogRef} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" aria-describedby="profile-modal-description" tabIndex={-1} className="mc-modal mc-modal--medium">
                <div className="mc-modal__header mc-modal__header--dark">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-xl border border-white/10 bg-white/10 p-2.5 text-violet-300 backdrop-blur-md"><UserRound className="h-5 w-5" /></div>
                        <div className="min-w-0"><h2 id="profile-modal-title" className="truncate text-lg font-black tracking-tight">个人资料</h2><p id="profile-modal-description" className="mt-0.5 text-xs font-medium text-slate-300">管理您的个人头像与账号安全</p></div>
                    </div>
                    <button type="button" onClick={close} disabled={busy} aria-label="关闭个人资料窗口" className="mc-icon-button mc-modal__close !text-white/60 hover:!bg-white/10 hover:!text-white"><X className="h-5 w-5" /></button>
                </div>
                <div className="mc-modal__body custom-scrollbar">
                    {refreshPending && <div className="mc-alert mc-alert--warning mb-4 items-center justify-between" role="status"><span>更改已保存，但账号信息同步失败，请重试刷新。</span><button type="button" disabled={busy} onClick={retryRefresh} className="mc-button mc-button--secondary mc-button--compact">{refreshing ? '刷新中…' : '重试刷新'}</button></div>}
                    <div className="grid gap-5 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                        <section className="rounded-[1.35rem] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-5 dark:border-indigo-900/60 dark:from-indigo-950/60 dark:via-slate-900 dark:to-violet-950/40">
                            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-slate-800 dark:text-white">个人头像</h3><p className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">上传一个代表您的 Logo</p></div><Camera className="h-4 w-4 text-indigo-400" /></div>
                            <div className="mt-6 flex flex-col items-center text-center">
                                <button ref={avatarRef} type="button" onClick={() => fileRef.current?.click()} aria-label="选择个人头像" className="group relative h-28 w-28 overflow-hidden rounded-full border-4 border-white bg-indigo-100 text-4xl font-black text-indigo-600 shadow-xl shadow-indigo-200/60 transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-slate-700 dark:bg-indigo-950 dark:text-indigo-300 dark:shadow-indigo-950/40">
                                    {draft.avatarDataUrl ? <img src={draft.avatarDataUrl} alt="" className="h-full w-full bg-white object-contain p-2" /> : avatarInitial}
                                    <span className="absolute inset-x-0 bottom-0 flex translate-y-1/2 items-center justify-center bg-slate-950/70 pb-2 pt-4 text-[10px] font-bold text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">更换头像</span>
                                </button>
                                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" onChange={chooseFile} />
                                <p className="mt-3 text-xs font-bold text-slate-600 dark:text-slate-300">{displayName}</p>
                                <p className="mt-1 max-w-[15rem] text-[11px] leading-5 text-slate-400">支持 PNG、JPEG、WebP、GIF、AVIF，单张不超过 100KB</p>
                                <div className="mt-4 flex flex-wrap justify-center gap-2">
                                    <button type="button" onClick={() => fileRef.current?.click()} className="mc-button mc-button--secondary mc-button--compact !border-indigo-200 !text-indigo-600 hover:!bg-indigo-50 dark:!border-indigo-800 dark:!text-indigo-300 dark:hover:!bg-indigo-950/60"><ImagePlus className="h-3.5 w-3.5" />选择图片</button>
                                    {draft.avatarDataUrl && <button type="button" onClick={() => setAvatar('')} className="mc-button mc-button--ghost mc-button--compact !text-slate-500">移除</button>}
                                </div>
                            </div>
                            <div className="mt-6 rounded-xl border border-white/80 bg-white/65 p-3 dark:border-slate-700/70 dark:bg-slate-900/45"><div className="flex items-center gap-2 text-[11px] font-bold text-indigo-600 dark:text-indigo-300"><Save className="h-3.5 w-3.5" />头像会同步显示在右上角</div></div>
                        </section>
                        <div className="space-y-5">
                            <section className="rounded-2xl border border-slate-200/80 bg-slate-50/75 p-4 dark:border-slate-700 dark:bg-slate-900/55">
                                <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-100 p-2 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h3 className="text-sm font-black text-slate-800 dark:text-white">账号信息</h3><p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">用户名、登录邮箱和身份由系统管理，不能在此修改。</p></div></div>
                                <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                                    {[['登录用户名', username || '未设置'], ['登录邮箱', user?.email || '未绑定邮箱'], ['当前身份', ROLE_LABELS[user?.role] || user?.role || '平台用户'], ['所属班级', user?.className || '未分配班级']].map(([label, value]) => <div key={label} className="rounded-xl bg-white/80 p-3 dark:bg-slate-800/70"><span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">{label === '登录邮箱' && <Mail className="h-3 w-3" />}{label}</span><span className="mt-1 block truncate font-black text-slate-700 dark:text-slate-200">{value}</span></div>)}
                                </div>
                            </section>
                            <section className="rounded-2xl border border-violet-100 bg-violet-50/45 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
                                <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-600 dark:bg-violet-950/70 dark:text-violet-300"><KeyRound className="h-4 w-4" /></div><div><h3 className="text-sm font-black text-slate-800 dark:text-white">登录密码</h3><p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">定期更新密码，保护您的 mcgo.app 账号。</p></div></div><button type="button" onClick={() => setShowPassword(value => !value)} className="mc-button mc-button--ghost mc-button--compact !px-2 !text-[11px]">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showPassword ? '隐藏密码' : '显示密码'}</button></div>
                                {user?.passwordChangeRecommended ? <div className="mc-alert mc-alert--warning mt-4 !p-3 text-[11px]">当前账号使用的是管理员设置的密码，可直接设置新的登录密码。</div> : <label className="mt-4 block"><span className="mc-field-label">当前密码</span><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={event => { setCurrentPassword(event.target.value); setPasswordError(''); }} className="mc-input" placeholder="输入当前登录密码" /></label>}
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <label className="block"><span className="mc-field-label">新密码</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setPasswordError(''); setPasswordSuccess(''); }} className="mc-input" placeholder="6–128 位" /></label>
                                    <label className="block"><span className="mc-field-label">确认新密码</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => { setConfirmation(event.target.value); setPasswordError(''); setPasswordSuccess(''); }} className="mc-input" placeholder="再次输入新密码" /></label>
                                </div>
                                {(passwordError || passwordSuccess) && <div role={passwordError ? 'alert' : 'status'} className={`mt-3 text-xs font-bold ${passwordError ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{passwordError || passwordSuccess}</div>}
                                <div className="mt-4 flex justify-end"><button type="button" onClick={changePassword} disabled={busy || (!password && !confirmation)} className="mc-button mc-button--accent mc-button--compact">{changingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}{changingPassword ? '正在更新…' : '更新密码'}</button></div>
                            </section>
                        </div>
                    </div>
                    {error && <div role="alert" className="mc-alert mc-alert--error mt-5"><span>{error}</span></div>}
                </div>
                <div className="mc-modal__footer"><button type="button" onClick={close} disabled={busy} className="mc-button mc-button--secondary">取消</button><button type="submit" disabled={busy || !changed} className="mc-button mc-button--primary min-w-28">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? '正在保存…' : '保存资料'}</button></div>
            </form>
        </div>
    );
}
