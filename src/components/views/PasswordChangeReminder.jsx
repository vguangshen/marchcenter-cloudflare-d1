import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

export default function PasswordChangeReminder({ username, onComplete, onDismiss }) {
    const [editing, setEditing] = useState(false);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useModalAccessibility(true, onDismiss);

    const submit = async event => {
        event.preventDefault();
        setError('');
        if (password.length < 6 || password.length > 128) {
            setError('新密码长度需为 6–128 位');
            return;
        }
        if (password !== confirm) {
            setError('两次输入的新密码不一致');
            return;
        }
        setLoading(true);
        try {
            await api.post('/auth/change-password', { password }, {
                fallback: '修改密码失败', retry: 0
            });
            await onComplete?.();
        } catch (requestError) {
            setError(requestError.message || '修改密码失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm">
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="password-reminder-title" tabIndex={-1} className="relative w-full max-w-md rounded-[2rem] border border-indigo-100 bg-white/95 p-7 shadow-2xl outline-none backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95">
                <button type="button" onClick={onDismiss} aria-label="稍后修改" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300/40"><KeyRound className="h-7 w-7" /></div>
                <h1 id="password-reminder-title" className="mt-5 text-center text-xl font-black text-slate-900 dark:text-white">建议修改登录密码</h1>
                <p className="mt-2 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {username ? `账号 ${username} 使用了管理员重置密码。` : '当前账号使用了管理员重置密码。'} 为保护账号，建议改成只有你知道的密码。
                </p>

                {editing ? (
                    <form onSubmit={submit} className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300">新密码</span>
                            <div className="relative">
                                <ShieldCheck className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input autoFocus type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="account-api-input w-full pl-10 pr-11" placeholder="6–128 位" />
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
                            {loading ? '正在保存…' : '保存新密码'}
                        </button>
                        <button type="button" onClick={onDismiss} className="h-10 w-full rounded-xl text-xs font-bold text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800">稍后修改</button>
                    </form>
                ) : (
                    <div className="mt-6 grid grid-cols-2 gap-3">
                        <button type="button" onClick={onDismiss} className="h-11 rounded-xl border border-slate-200 bg-white text-sm font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">稍后修改</button>
                        <button type="button" onClick={() => setEditing(true)} className="h-11 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-sm font-black text-white shadow-lg shadow-indigo-300/40 transition hover:brightness-110">现在修改</button>
                    </div>
                )}
                <p className="mt-4 text-center text-[10px] text-slate-400">本次关闭后可继续使用；若仍未修改，下次登录会再次提醒。</p>
            </section>
        </div>
    );
}
