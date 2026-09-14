import React from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';

export const STEP_HEIGHT = 72;
export const CONNECTOR_HEIGHT = 20;
export const TOTAL_ITEM_HEIGHT = STEP_HEIGHT + CONNECTOR_HEIGHT;

export function ConnectorLine({ isActive, isDone, isErrorLine }) {
    return (
        <div className="w-0.5 ml-[19px] relative bg-slate-200 dark:bg-slate-700 overflow-hidden mx-auto" style={{ height: `${CONNECTOR_HEIGHT}px` }}>
            <div className={`absolute top-0 left-0 w-full transition-all duration-500 ease-in-out ${isErrorLine ? 'bg-red-400 h-full opacity-100' : isDone ? 'bg-emerald-400 h-full opacity-100' : isActive ? 'bg-emerald-400 h-full opacity-100 animate-flow-down' : 'h-0 opacity-0'}`} />
        </div>
    );
}

export function StepItem({ stepNumber, label, subLabel, currentStep, icon: Icon, isErrorState }) {
    let status = 'pending';
    if (isErrorState && currentStep === stepNumber) status = 'error';
    else if (currentStep > stepNumber) status = 'done';
    else if (currentStep === stepNumber) status = 'active';

    return (
        <div className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-500 w-full box-border border ${status === 'error' ? 'bg-red-50 dark:bg-red-950/70 border-red-200 dark:border-red-800 animate-shake' : status === 'active' ? 'bg-white dark:bg-slate-900 shadow-sm border-slate-100 dark:border-slate-700' : status === 'done' ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-100/30 dark:border-emerald-800/40 opacity-50' : 'opacity-40 border-transparent'}`} style={{ height: `${STEP_HEIGHT}px` }}>
            <div className="relative shrink-0">
                <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border ${status === 'error' ? 'bg-red-50 border-red-200 text-red-500' : status === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : status === 'active' ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                    {status === 'error' ? <XCircle className="w-4 h-4" /> : status === 'done' ? <CheckCircle2 className="w-4 h-4" /> : status === 'active' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-600 dark:text-slate-200">{label}</div>
                <div className="text-xs text-slate-400 dark:text-slate-400 mt-0.5 truncate">{subLabel || '等待中'}</div>
            </div>
        </div>
    );
}
