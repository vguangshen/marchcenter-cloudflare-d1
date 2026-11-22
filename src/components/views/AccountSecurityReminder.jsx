import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, ShieldAlert } from 'lucide-react';
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

// Keeps a finished step mounted while its height folds away.
function Section({ show, className = '', children }) {
    const [mounted, setMounted] = useState(show);
    const [visible, setVisible] = useState(show);
    useEffect(() => {
        if (show) {
            setMounted(true);
            const frame = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(frame);
        }
        setVisible(false);
        const timer = window.setTimeout(() => setMounted(false), 600);
        return () => window.clearTimeout(timer);
    }, [show]);
    if (!mounted) return null;
    return (
        <div className={`acct-section ${visible ? '' : 'acct-section--hidden'}`} aria-hidden={!show}
            onTransitionEnd={event => {
                if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && !show) setMounted(false);
            }}>
            <div><div className={className}>{children}</div></div>
        </div>
    );
}

/**
 * Bottom-right reminder shown during the grace period for an administrator
 * chosen password and/or while the account has no email. It never blocks the
 * workbench; once the deadline passes App switches to the locked screen.
 *
 * phase: enter → open → closing → collapsed → enter …, and finishing → gone
 * once both steps are done. Every transition waits for its animation to end.
 */
export default function AccountSecurityReminder({ user, isDarkMode, onUserUpdated, onPasswordChanged }) {
    const needsPassword = Boolean(user.passwordChangeRecommended);
    const needsEmail = !user.email;
    const pending = needsPassword || needsEmail;

    const [phase, setPhase] = useState(() => (!pending ? 'gone' : readCollapsed(user.id) ? 'collapsed' : 'enter'));
    const [now, setNow] = useState(() => Date.now());
    const lastDue = useRef(passwordChangeDue(user, now));
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!pending && phase !== 'gone' && phase !== 'finishing') {
            setPhase(phase === 'collapsed' ? 'gone' : 'finishing');
        }
    }, [pending, phase]);

    // animationend drives the phases; this fallback keeps them moving if the
    // animation never runs (stylesheet missing, element hidden, etc.).
    useEffect(() => {
        const next = { enter: 'open', closing: 'collapsed', finishing: 'gone' }[phase];
        if (!next) return undefined;
        const timer = window.setTimeout(() => setPhase(current => (current === phase ? next : current)), 700);
        return () => window.clearTimeout(timer);
    }, [phase]);

    if (phase === 'gone') return null;

    const due = passwordChangeDue(user, now);
    if (due !== null) lastDue.current = due;
    const shownDue = lastDue.current;
    const countdown = shownDue !== null ? remainingDaysLabel(shownDue, now) : '';
    const dueDate = shownDue !== null ? new Date(shownDue).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) : '';

    const collapse = () => { if (phase === 'open' || phase === 'enter') { setPhase('closing'); writeCollapsed(user.id, true); } };
    const expand = () => { setPhase('enter'); writeCollapsed(user.id, false); };
    const onCardAnimationEnd = event => {
        if (event.target !== event.currentTarget) return;
        if (phase === 'enter') setPhase('open');
        else if (phase === 'closing') setPhase('collapsed');
        else if (phase === 'finishing') setPhase('gone');
    };

    if (phase === 'collapsed') {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} fixed bottom-5 right-5 z-[150]`}>
                <button type="button" onClick={expand} aria-expanded="false"
                    className="acct-glass acct-pill--enter flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-black text-amber-700 transition-transform duration-200 hover:-translate-y-0.5 dark:text-amber-300">
                    <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                    </span>
                    <ShieldAlert className="h-4 w-4" />
                    账号安全待完善{needsPassword && countdown ? ` · ${countdown}` : ''}
                </button>
            </div>
        );
    }

    const animation = phase === 'enter' ? 'acct-card--enter' : phase === 'open' ? '' : 'acct-card--exit';
    return (
        <div className={`${isDarkMode ? 'dark' : ''} fixed bottom-5 right-5 z-[150] w-[min(calc(100vw-2.5rem),360px)]`}>
            <section role="region" aria-labelledby="account-reminder-title" onAnimationEnd={onCardAnimationEnd}
                className={`acct-glass ${animation} max-h-[calc(100vh-2.5rem)] overflow-y-auto rounded-3xl p-5`}>
                <header className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-400/30">
                        <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 id="account-reminder-title" className="text-sm font-black text-slate-900 dark:text-white">完善账号安全</h2>
                        <p className="mt-0.5 text-[11px] leading-5 text-slate-600 dark:text-slate-300">
                            {needsPassword
                                ? `当前使用的是管理员设置的密码，请在 ${dueDate} 前修改，逾期后需修改密码才能继续使用。`
                                : needsEmail ? '绑定邮箱后，可使用邮箱验证码登录和找回密码。' : '账号安全设置已完成。'}
                        </p>
                    </div>
                    <button type="button" onClick={collapse} aria-label="收起提醒" title="收起提醒" aria-expanded="true"
                        className="acct-collapse-toggle -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100">
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </header>

                <Section show={needsPassword} className="pt-3">
                    <span className="inline-flex items-center rounded-full border border-amber-200/70 bg-amber-50/70 px-2.5 py-1 text-[11px] font-black text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300">
                        {countdown}
                    </span>
                </Section>

                <Section show={needsEmail} className="pt-4">
                    <EmailBindForm onBound={onUserUpdated} />
                </Section>

                <Section show={needsPassword} className={needsEmail ? 'acct-divider mt-1 pt-4' : 'pt-4'}>
                    <PasswordChangeForm onChanged={onPasswordChanged} />
                    <p className="mt-2 text-center text-[10px] text-slate-500 dark:text-slate-400">修改成功后，其他设备上的旧登录会自动失效。</p>
                </Section>
            </section>
        </div>
    );
}
