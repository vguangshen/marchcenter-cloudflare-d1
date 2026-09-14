import React from 'react';
import { Loader2, RotateCcw, ShieldCheck, Trash2, Wrench } from 'lucide-react';

export default function ClassActionOverlay({
    running,
    initializing,
    deleting,
    repairing,
    accountReady,
    javaResync,
    canInitialize,
    canRepair,
    onDelete,
    onInitialize,
    onRepair,
    onCancel
}) {
    return (
        <div className="glass-motion-surface absolute inset-0 z-30 flex items-center justify-center overflow-hidden rounded-3xl border border-red-200/50 bg-white/92 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 dark:border-red-900/30 dark:bg-slate-900/92">
            <div className="flex flex-col items-center gap-2.5 px-5 text-center">
                <div className={`mb-0.5 flex h-9 w-9 items-center justify-center rounded-full shadow-sm ${running ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60'}`}>
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                </div>
                <span className="text-xs font-black tracking-tight text-slate-800 dark:text-slate-100">
                    {repairing ? '正在修复登录…' : initializing ? '正在初始化系统…' : deleting ? '正在删除班级…' : '系统维护'}
                </span>
                <span className="max-w-[210px] text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                    {running
                        ? (repairing ? '正在同步教师、主学生和附加学生账号，请稍候' : initializing ? '正在清空该平台全部班级数据，请稍候' : '正在同步删除平台班级记录，请稍候')
                        : accountReady
                            ? `${javaResync ? 'Java' : '.NET'} 账号已同步；若登录异常，可立即重新同步账号`
                            : `${javaResync ? 'Java' : '.NET'} 账号尚未就绪，可立即同步并修复登录`}
                </span>
                {!running && (
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                        {canRepair && (
                            <button type="button" onClick={onRepair} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-[10px] font-black text-white shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 active:scale-95">
                                <ShieldCheck className="h-3.5 w-3.5" />修复登录
                            </button>
                        )}
                        <button type="button" onClick={onDelete} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-3 py-2 text-[10px] font-black text-white shadow-lg shadow-red-500/30 transition-all hover:scale-105 active:scale-95">
                            <Trash2 className="h-3.5 w-3.5" />删除班级
                        </button>
                        {canInitialize && (
                            <button type="button" onClick={onInitialize} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-3 py-2 text-[10px] font-black text-white shadow-lg shadow-orange-500/30 transition-all hover:scale-105 active:scale-95">
                                <RotateCcw className="h-3.5 w-3.5" />初始化系统
                            </button>
                        )}
                        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200/60 bg-slate-100 px-3 py-2 text-[10px] font-black text-slate-600 transition-all hover:bg-slate-200 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                            取消
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
