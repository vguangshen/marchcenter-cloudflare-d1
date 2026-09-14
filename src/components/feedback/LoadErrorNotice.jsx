import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const LoadErrorNotice = ({ message, onRetry, compact = false }) => {
    if (!message) return null;
    return (
        <div className={`flex items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50/80 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`} role="alert">
            <div className="flex min-w-0 items-center gap-2 text-xs font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words" title={String(message)}>{message}</span>
            </div>
            {onRetry && (
                <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/80 px-3 py-1.5 text-xs font-black text-red-600 shadow-sm transition hover:bg-white dark:bg-slate-900/70 dark:text-red-300">
                    <RefreshCw className="h-3.5 w-3.5" />重试
                </button>
            )}
        </div>
    );
};

export default LoadErrorNotice;
