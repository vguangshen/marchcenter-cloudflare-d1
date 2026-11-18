import React from 'react';
import { Bot, Edit2, Trash2, Loader2, Sparkles, ExternalLink, RotateCcw, RefreshCw, Award, ClipboardList } from 'lucide-react';
import { agentPlatformThemeStyle } from '../../utils/paasV2Platforms';

const scoreFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

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
    theme = 'violet',
    isAdmin = false,
    onEdit,
    onDelete,
    onOpen,
    onReset,
    onRefreshScore,
    scoreResult = link.agentResult,
    scoreLoading = false,
    scoreError = '',
    resetting = false,
    openingCompetitionKeys = new Set(),
    isCardEditMode = false
}) => {
    const isOpening = openingCompetitionKeys.has(`${link.id}:student:`);
    const hasEntered = Number(link.has_executed) === 1;
    const cover = link.paasV2Cover || link.cover || '';
    const status = scoreResult?.status;
    const isCompleted = status === 'completed';
    const hasStarted = hasEntered || isCompleted || status === 'scoring';
    const hasScore = isCompleted && Number.isFinite(scoreResult.score);
    const scoreStatus = !hasStarted ? '未开始' : scoreError ? '查分失败' : scoreLoading ? '查询中' : status === 'scoring' ? '评分中'
        : status === 'in_progress' ? '未完成' : status === 'completed' ? '暂无得分' : '未查分';
    const refreshLabel = scoreLoading ? '查询中' : scoreError ? '重试查分' : scoreResult ? '刷新得分' : '查询得分';
    const openLabel = isCompleted ? (isOpening ? '正在打开详情' : '得分详情') : isOpening ? '进入中'
        : hasStarted ? '继续智能体任务' : '进入智能体任务';

    const openTask = event => {
        event.preventDefault();
        event.stopPropagation();
        if (isCompleted) onOpen?.(link, 'student', null, { scoreDetails: true });
        else onOpen?.(link, 'student', null);
    };

    const resetTask = event => {
        event.preventDefault();
        event.stopPropagation();
        onReset?.(link);
    };

    return (
        <article style={agentPlatformThemeStyle(theme)} className="agent-task-card group relative flex h-full min-h-[190px] overflow-hidden rounded-[22px] border bg-white/85 transition-all duration-300 hover:-translate-y-0.5 dark:bg-slate-900/85">
            <div className="agent-task-accent-bar absolute inset-y-0 left-0 w-1.5" />
            {isAdmin && isCardEditMode && (
                <div className="absolute right-2 top-2 z-20 flex gap-1">
                    <button type="button" onClick={event => { event.preventDefault(); onEdit(link); }} className="rounded-lg border border-white bg-white/90 p-1.5 text-indigo-600 shadow-sm hover:bg-indigo-50"><Edit2 className="h-3 w-3" /></button>
                    <button type="button" onClick={event => { event.preventDefault(); onDelete(link.id); }} className="rounded-lg border border-white bg-white/90 p-1.5 text-red-500 shadow-sm hover:bg-red-50"><Trash2 className="h-3 w-3" /></button>
                </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col p-3 pl-4 pb-4">
                <div className="flex min-w-0 items-start gap-2">
                    {cover ? <img loading="lazy" decoding="async" src={cover} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover shadow-sm" /> : <span className="agent-task-cover-placeholder grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow-sm"><Sparkles className="h-6 w-6" /></span>}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="agent-task-badge inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-black"><Bot className="h-2.5 w-2.5" />智能体</span>
                            <span className="truncate text-[9px] font-bold text-slate-400">{platformLabel(link)}</span>
                        </div>
                        <h3 className="mt-1.5 truncate text-sm font-black text-slate-900 dark:text-white" title={link.title}>{link.title}</h3>
                    </div>
                </div>

                {link.description ? <p className="mt-2 line-clamp-4 text-[10px] leading-4 text-slate-500 dark:text-slate-400" title={link.description}>{link.description}</p> : null}

                <div className="mt-auto pt-2.5">
                    <div className="agent-task-score flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-xl border px-2.5 py-1">
                        <div role="status" className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5" title={scoreError || undefined}>
                            <span className="agent-task-score-label inline-flex items-center gap-1 text-[11px] font-semibold"><Award aria-hidden="true" className="h-3.5 w-3.5" />得分</span>
                            {hasScore ? (
                                <>
                                    <span className="agent-task-score-value text-base leading-none font-extrabold tabular-nums">{scoreFormatter.format(scoreResult.score)}<span className="ml-0.5 text-[10px] font-semibold">分</span></span>
                                    {scoreError && <span className="text-[10px] font-semibold text-rose-700 dark:text-rose-300">刷新失败</span>}
                                </>
                            ) : (
                                <span className={`text-[11px] font-semibold ${scoreError ? 'text-rose-700 dark:text-rose-300' : status === 'scoring' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>{scoreStatus}</span>
                            )}
                            {isCompleted && <span className="agent-task-badge rounded-full px-1.5 py-0.5 text-[10px] font-semibold">已完成</span>}
                        </div>
                        {hasStarted && onRefreshScore && (
                            <button type="button" onClick={() => onRefreshScore(link)} disabled={scoreLoading || resetting || isOpening} aria-busy={scoreLoading} className="mc-button mc-button--ghost agent-task-score-action ml-auto !min-h-8 !gap-1 !rounded-lg !px-1.5 !py-1 !text-[10px]">
                                <RefreshCw aria-hidden="true" className={`h-3 w-3 shrink-0 ${scoreLoading ? 'animate-spin' : ''}`} />
                                {refreshLabel}
                            </button>
                        )}
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-1.5">
                        {onReset && (
                            <button type="button" onClick={resetTask} disabled={resetting || isOpening} aria-busy={resetting} className="mc-button mc-button--secondary mc-button--compact !min-h-10 shrink-0 !rounded-xl !px-2 !text-[11px]">
                                {resetting ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />}
                                {resetting ? '重置中' : '重置任务'}
                            </button>
                        )}
                        <button type="button" onClick={openTask} disabled={isOpening || resetting || (isCompleted && scoreLoading)} aria-busy={isOpening} title={openLabel} className={`mc-button ${isCompleted ? 'agent-task-details-button' : 'mc-button--accent agent-task-enter-button text-white shadow-sm'} !min-h-10 min-w-0 flex-1 !gap-1.5 !rounded-xl !px-2 !text-[11px] !font-black`}>
                            {isOpening ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" /> : isCompleted ? <ClipboardList aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <ExternalLink aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                            <span className="truncate">{openLabel}</span>
                        </button>
                    </div>
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
