import React, { useEffect, useState } from 'react';
import { ChevronDown, KeyRound, ShieldAlert, X } from 'lucide-react';
import { EmailBindForm, PasswordChangeForm } from './AccountSecurityForms';
import { passwordChangeDue, remainingDaysLabel } from './accountSecurity';

const collapsedKey = userId => `marchcenter:account-reminder-collapsed:${userId}`;

function readCollapsed(userId) {
    try { return sessionStorage.getItem(collapsedKey(userId)) === '1'; } catch { return false; }
}

function writeCollapsed(userId, collapsed) {
    try {
        if (collapsed) sessionStorage.setItem(collapsedKey(userId), '1');
        else sessionStorage.removeItem(collapsedKey(userId));
    } catch { /* storage unavailable: the state just isn't remembered */ }
}

/**
 * Bottom-right reminder shown during the grace period for an administrator
 * chosen password and/or while the account has no email. It never blocks the
 * workbench; once the deadline passes App switches to the locked screen.
 */
export default function AccountSecurityReminder({ user, isDarkMode, onUserUpdated, onPasswordChanged }) {
    const [collapsed, setCollapsed] = useState(() => readCollapsed(user.id));
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const needsPassword = Boolean(user.passwordChangeRecommended);
    const needsEmail = !user.email;
    if (!needsPassword && !needsEmail) return null;

    const due = passwordChangeDue(user, now);
    const countdown = needsPassword ? remainingDaysLabel(due, now) : '';
    const dueDate = needsPassword ? new Date(due).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : '';
    const toggle = value => { setCollapsed(value); writeCollapsed(user.id, value); };

    if (collapsed) {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} fixed bottom-5 right-5 z-[150]`}>
                <button type="button" onClick={() => toggle(false)}
                    className="flex items-center gap-2 rounded-full border border-amber-200 bg-white/95 px-4 py-2.5 text-xs font-black text-amber-700 shadow-xl backdrop-blur-xl transition hover:-translate-y-0.5 dark:border-amber-500/30 dark:bg-slate-900/95 dark:text-amber-300">
                    <ShieldAlert className="h-4 w-4" />
                    账号安全待完善{countdown ? ` · ${countdown}` : ''}
                </button>
            </div>
        );
    }

    return (
        <div className={`${isDarkMode ? 'dark' : ''} fixed bottom-5 right-5 z-[150] w-[min(calc(100vw-2.5rem),360px)]`}>
            <section role="region" aria-labelledby="account-reminder-title"
                className="max-h-[calc(100vh-2.5rem)] overflow-y-auto rounded-3xl border border-slate-200/80 bg-white/95 p-5 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-4 fade-in duration-300 dark:border-slate-700 dark:bg-slate-900/95">
                <header className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-300/40">
                        <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 id="account-reminder-title" className="text-sm font-black text-slate-900 dark:text-white">完善账号安全</h2>
                        <p className="mt-0.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                            {needsPassword
                                ? `当前使用的是管理员设置的密码，请在 ${dueDate} 前修改，逾期后需修改密码才能继续使用。`
                                : '绑定邮箱后，可使用邮箱验证码登录和找回密码。'}
                        </p>
                    </div>
                    <button type="button" onClick={() => toggle(true)} aria-label="收起提醒" title="收起提醒"
                        className="mc-icon-button -mr-1 -mt-1 shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                        {needsPassword ? <ChevronDown className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    </button>
                </header>

                {needsPassword && (
                    <div className="mt-3 inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        {countdown}
                    </div>
                )}

                {needsEmail && (
                    <div className="mt-4">
                        <EmailBindForm onBound={onUserUpdated} />
                    </div>
                )}

                {needsPassword && (
                    <div className={needsEmail ? 'mt-1 border-t border-slate-100 pt-4 dark:border-slate-800' : 'mt-4'}>
                        <PasswordChangeForm onChanged={onPasswordChanged} />
                        <p className="mt-2 text-center text-[10px] text-slate-400">修改成功后，其他设备上的旧登录会自动失效。</p>
                    </div>
                )}
            </section>
        </div>
    );
}
