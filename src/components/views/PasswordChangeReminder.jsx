import React from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { EmailBindForm, PasswordChangeForm } from './AccountSecurityForms';

// Shown once the reminder period for an administrator-chosen password has
// ended. The server rejects every other request until the password changes,
// so this screen is the only way forward. Email binding stays optional.
export default function PasswordChangeReminder({ user, onUserUpdated, onComplete, onLogout }) {
    // Escape must not dismiss a required step.
    const dialogRef = useModalAccessibility(true, () => {});
    const username = user?.username;

    return (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm">
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="password-reminder-title" aria-describedby="password-reminder-description" tabIndex={-1} className="relative max-h-[calc(100vh-2.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] border border-indigo-100 bg-white/95 p-7 shadow-2xl outline-none backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-300/40"><KeyRound className="h-7 w-7" /></div>
                <h1 id="password-reminder-title" className="mt-5 text-center text-xl font-black text-slate-900 dark:text-white">请先修改登录密码</h1>
                <p id="password-reminder-description" className="mt-2 text-center text-sm leading-6 text-slate-500 dark:text-slate-400">
                    {username ? `账号 ${username} ` : '当前账号'}仍在使用管理员设置的初始密码或重置密码，提醒期已结束。设置只有你知道的新密码后才能继续使用。
                </p>

                {!user?.email && (
                    <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                        <EmailBindForm onBound={onUserUpdated} />
                        <p className="text-[10px] text-slate-400">选填，绑定后可用邮箱验证码登录和找回密码。</p>
                    </div>
                )}

                <div className="mt-6">
                    <PasswordChangeForm autoFocus onChanged={onComplete} submitLabel="保存新密码并进入" />
                </div>
                <button type="button" onClick={onLogout} className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"><LogOut className="h-3.5 w-3.5" />退出登录</button>
                <p className="mt-4 text-center text-[10px] text-slate-400">修改成功后，其他设备上的旧登录会自动失效。</p>
            </section>
        </div>
    );
}
