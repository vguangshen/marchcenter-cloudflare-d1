import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { bindMyEmail, changePassword } from '../../utils/api';
import { validateEmail, validateNewPassword } from './accountSecurity';

const LABEL = 'mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300';
const ERROR = 'min-h-4 text-[11px] font-bold text-red-600 dark:text-red-400';

export function EmailBindForm({ onBound, autoFocus = false }) {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const submit = async event => {
        event.preventDefault();
        if (loading) return;
        const problem = validateEmail(email);
        if (problem) { setError(problem); return; }
        setLoading(true);
        setError('');
        try {
            const user = await bindMyEmail(email.trim());
            await onBound?.(user);
        } catch (requestError) {
            setError(requestError.message || '邮箱绑定失败');
            setLoading(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-1.5" noValidate>
            <label className={LABEL} htmlFor="account-security-email">绑定邮箱</label>
            <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input id="account-security-email" type="email" autoComplete="email" autoFocus={autoFocus}
                        value={email} onChange={event => { setEmail(event.target.value); setError(''); }}
                        className="mc-input mc-input--compact !pl-9" placeholder="用于验证码登录和找回密码" />
                </div>
                <button type="submit" disabled={loading} className="mc-button mc-button--secondary mc-button--compact shrink-0">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '绑定'}
                </button>
            </div>
            <div className={ERROR} aria-live="polite">{error}</div>
        </form>
    );
}

export function PasswordChangeForm({ onChanged, submitLabel = '保存新密码', autoFocus = false }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const submit = async event => {
        event.preventDefault();
        if (loading) return;
        const problem = validateNewPassword(password, confirm);
        if (problem) { setError(problem); return; }
        setLoading(true);
        setError('');
        try {
            await changePassword({ password });
            await onChanged?.();
        } catch (requestError) {
            setError(requestError.message || '修改密码失败');
            setLoading(false);
        }
    };

    return (
        <form onSubmit={submit} className="space-y-3" noValidate>
            <label className="block">
                <span className={LABEL}>新密码</span>
                <div className="relative">
                    <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input autoFocus={autoFocus} type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                        value={password} onChange={event => { setPassword(event.target.value); setError(''); }}
                        className="mc-input mc-input--compact !pl-9 !pr-10" placeholder="6–128 位，不能为 123456" />
                    <button type="button" onClick={() => setShowPassword(value => !value)}
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-indigo-600">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </label>
            <label className="block">
                <span className={LABEL}>确认新密码</span>
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                    value={confirm} onChange={event => { setConfirm(event.target.value); setError(''); }}
                    className="mc-input mc-input--compact" placeholder="再次输入" />
            </label>
            <div className={ERROR} aria-live="polite">{error}</div>
            <button type="submit" disabled={loading} className="mc-button mc-button--accent w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {loading ? '正在保存…' : submitLabel}
            </button>
        </form>
    );
}
