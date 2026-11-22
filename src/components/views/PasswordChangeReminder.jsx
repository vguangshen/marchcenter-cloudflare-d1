import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { changePassword } from '../../utils/api';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

// The administrator reset password is shared knowledge (123456), so the
// account stays locked to this dialog until the user chooses a new password.
// The server enforces the same rule; this screen is the only way forward.
export const RESET_DEFAULT_PASSWORD = '123456';

export default function PasswordChangeReminder({ username, onComplete, onLogout }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Escape must not dismiss a required step.
    const dialogRef = useModalAccessibility(true, () => {});

    const submit = async event => {
        event.preventDefault();
        if (loading) return;
        setError('');
        if (password.length < 6 || password.length > 128) {
            setError('新密码长度需为 6–128 位');
            return;
        }
        if (password === RESET_DEFAULT_PASSWORD) {
            setError('新密码不能继续使用默认密码 123456');
            return;
        }
        if (password !== confirm) {
            setError('两次输入的新密码不一致');
            return;
        }
        setLoading(true);
        try {
            await changePassword({ password });
            await onComplete?.();
        } catch (requestError) {
            setError(requestError.message || '修改密码失败');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm">
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="password-reminder-title" aria-describedby="password-reminder-description" tabIndex={-1} className="relative w-full max-w-md rounded-[2rem] border border-indigo-100 bg-white/95 p-7 shadow-2xl outline-none backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300/40"><KeyRound className="h-7 w-7" /></div>
                <h1 id="password-reminder-title" className="mt-5 text-center text-xl font-black text-slate-900 dark:text-white">请先修改登录密码</h1>
                <p id="password-reminder-description" className="mt-2 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {username ? `账号 ${username} 当前使用的是管理员设置的初始密码或重置密码。` : '当前账号使用的是管理员设置的初始密码或重置密码。'}设置只有你知道的新密码后才能继续使用。
                </p>

                <form onSubmit={submit} className="mt-6 space-y-4">
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">新密码</span>
                        <div className="relative">
                            <ShieldCheck className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input autoFocus type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="account-api-input w-full pl-10 pr-11" placeholder="6–128 位，不能为 123456" />
                            <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-indigo-600">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                        </div>
                    </label>
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">确认新密码</span>
                        <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className="account-api-input w-full" placeholder="再次输入" />
                    </label>
                    <div className="min-h-5 text-xs font-bold text-red-600" aria-live="polite">{error}</div>
                    <button type="submit" disabled={loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-300/40 transition hover:brightness-110 disabled:opacity-60">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        {loading ? '正在保存…' : '保存新密码并进入'}
                    </button>
                    <button type="button" onClick={onLogout} disabled={loading} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-60 dark:hover:bg-slate-800"><LogOut className="h-3.5 w-3.5" />退出登录</button>
                </form>
                <p className="mt-4 text-center text-[10px] text-slate-400">修改成功后，其他设备上的旧登录会自动失效。</p>
            </section>
        </div>
    );
}
