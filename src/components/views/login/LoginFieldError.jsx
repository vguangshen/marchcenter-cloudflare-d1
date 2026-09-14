import React from 'react';
import { Ban } from 'lucide-react';

export const inferLoginErrorField = (message, fallback = 'form') => {
    const value = String(message || '');
    if (/用户名|账号/.test(value)) return 'username';
    if (/邮箱/.test(value)) return 'email';
    if (/验证码/.test(value)) return 'code';
    if (/确认|一致/.test(value)) return 'confirm';
    if (/密码/.test(value)) return 'password';
    return fallback;
};

export function LoginFieldError({ id, message }) {
    if (!message) return null;
    return (
        <span
            id={id}
            role="alert"
            title={message}
            className="pointer-events-none absolute right-3 top-1/2 z-10 flex max-w-[58%] -translate-y-1/2 items-center gap-1 truncate rounded-md bg-red-100/95 px-2 py-1 text-[10px] font-bold text-red-600 dark:bg-red-950/90 dark:text-red-300"
        >
            <Ban className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{message}</span>
        </span>
    );
}
