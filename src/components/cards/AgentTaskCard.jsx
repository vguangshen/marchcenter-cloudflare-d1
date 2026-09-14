import React, { useState } from 'react';
import { Bot, Edit2, Trash2, Loader2, Sparkles, ExternalLink, RotateCcw } from 'lucide-react';

const PLATFORM_LABELS = {
    KJDZSWRJXT: 'PT0401 跨境电子商务',
    scyxcjrh: 'PT0402 市场营销',
    kjrjxt09: 'PT0403 财经',
    dzswcjrh: 'PT0404 电子商务'
};

function platformLabel(link) {
    return PLATFORM_LABELS[link.paasV2SoftwareUnique || link.softwareUnique] || link.category || 'PT04 智能体';
}

const AgentTaskCard = ({
    link,
    isAdmin = false,
    onEdit,
    onDelete,
    onOpen,
    onReset,
    openingCompetitionKeys = new Set(),
    isCardEditMode = false
}) => {
    const isOpening = openingCompetitionKeys.has(`${link.id}:student:`);
    const hasEntered = Number(link.has_executed) === 1;
    const [resetting, setResetting] = useState(false);
    const cover = link.paasV2Cover || link.cover || '';

    const openTask = event => {
        event.preventDefault();
        event.stopPropagation();
        if (onOpen) onOpen(link, 'student', null);
    };

    const resetTask = async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!onReset || resetting) return;
        setResetting(true);
        try { await onReset(link); } finally { setResetting(false); }
    };

    return (
        <article className="group relative flex h-full min-h-[190px] overflow-hidden rounded-[22px] border border-violet-100 bg-white/85 shadow-[0_10px_28px_rgba(80,70,229,0.10)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(80,70,229,0.18)] dark:border-violet-900/60 dark:bg-slate-900/85">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-indigo-500 via-violet-500 to-fuchsia-500" />
            {isAdmin && isCardEditMode && (
                <div className="absolute right-2 top-2 z-20 flex gap-1">
                    <button type="button" onClick={event => { event.preventDefault(); onEdit(link); }} className="rounded-lg border border-white bg-white/90 p-1.5 text-indigo-600 shadow-sm hover:bg-indigo-50"><Edit2 className="h-3 w-3" /></button>
                    <button type="button" onClick={event => { event.preventDefault(); onDelete(link.id); }} className="rounded-lg border border-white bg-white/90 p-1.5 text-red-500 shadow-sm hover:bg-red-50"><Trash2 className="h-3 w-3" /></button>
                </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col p-3 pl-4 pb-4">
                <div className="flex min-w-0 items-start gap-2">
                    {cover ? <img src={cover} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover shadow-sm" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"><Sparkles className="h-6 w-6" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-black text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"><Bot className="h-2.5 w-2.5" />智能体</span>
                            <span className="truncate text-[9px] font-bold text-slate-400">{platformLabel(link)}</span>
                        </div>
                        <h3 className="mt-1.5 truncate text-sm font-black text-slate-900 dark:text-white" title={link.title}>{link.title}</h3>
                    </div>
                </div>

                {link.description ? <p className="mt-2 line-clamp-4 text-[10px] leading-4 text-slate-500 dark:text-slate-400" title={link.description}>{link.description}</p> : null}

                <div className="mt-auto flex items-center gap-1.5">
                    {onReset && <button type="button" onClick={resetTask} disabled={resetting} className="flex h-8 w-[82px] items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white text-[10px] font-bold text-slate-500 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RotateCcw className={`h-3 w-3 ${resetting ? 'animate-spin' : ''}`} />重置任务</button>}
                    <button type="button" onClick={openTask} disabled={isOpening} className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11px] font-black text-white shadow-sm transition disabled:cursor-wait disabled:opacity-70 ${hasEntered ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400' : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500'}`}>
                        {isOpening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                        {isOpening ? '进入中' : hasEntered ? '继续智能体任务' : '进入智能体任务'}
                    </button>
                </div>

                <div className="pointer-events-none absolute bottom-0 left-4 right-4 flex h-3 min-w-0 select-none items-end justify-between gap-2 text-[8px] font-mono font-medium leading-none opacity-40 text-slate-500 dark:text-slate-400">
                    <span className="min-w-0 flex-1 truncate" title={link.paasV2PlugFlag || link.plugFlag}>Task {link.paasV2PlugFlag || link.plugFlag || '—'}</span>
                    <span className="shrink-0">Type {link.paasV2AnswerType || link.answerType || '1'}</span>
                </div>
            </div>
        </article>
    );
};

export default AgentTaskCard;
