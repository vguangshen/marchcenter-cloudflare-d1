import React, { useEffect, useId, useRef, useState } from 'react';
import { Info, Loader2, RotateCcw, ShieldCheck, Trash2, Wrench } from 'lucide-react';

const DIRECT_AVAILABILITY = { delete: '直接跳转不支持删除班级' };

function MaintenanceButton({ icon: Icon, label, hint, disabled, tone, alignRight = false, showTooltip, onTooltipChange, onClick }) {
    const tooltipId = useId();
    const describeDisabledButton = disabled && Boolean(hint);
    const hideTooltip = () => onTooltipChange(false);

    return (
        <div className={`relative flex min-w-0 items-stretch gap-0.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${disabled ? 'cursor-not-allowed' : ''}`}
            role={describeDisabledButton ? 'group' : undefined}
            tabIndex={describeDisabledButton ? 0 : undefined}
            aria-label={describeDisabledButton ? label : undefined}
            aria-describedby={describeDisabledButton ? tooltipId : undefined}
            onPointerEnter={event => { if (hint && event.pointerType !== 'touch') onTooltipChange(true); }}
            onPointerLeave={hideTooltip}
            onFocus={event => { if (hint && event.target.matches(':focus-visible')) onTooltipChange(true); }}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) hideTooltip(); }}
            onKeyDown={event => {
                if (event.key === 'Escape' && showTooltip) {
                    event.stopPropagation();
                    hideTooltip();
                }
            }}>
            <button type="button" disabled={disabled} onClick={onClick} aria-describedby={hint ? tooltipId : undefined}
                className={`flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-1.5 text-[11px] font-black leading-tight transition-all ${disabled
                    ? 'pointer-events-none border-slate-300/70 bg-slate-200 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                    : `border-transparent bg-gradient-to-r text-white shadow-lg hover:scale-105 active:scale-95 ${tone}`}`}>
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />{label}
            </button>
            {describeDisabledButton && (
                <button type="button" className="maintenance-touch-hint grid w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-slate-300 dark:hover:bg-slate-800"
                    tabIndex={-1} aria-label={`查看${label}说明`} aria-controls={tooltipId} aria-expanded={showTooltip}
                    onClick={() => onTooltipChange(!showTooltip)}>
                    <Info aria-hidden="true" className="h-4 w-4" />
                </button>
            )}
            {hint && (
                <span id={tooltipId} role="tooltip" hidden={!showTooltip}
                    className={`pointer-events-none absolute bottom-full z-10 mb-2 w-44 break-words rounded-lg bg-slate-900 px-2.5 py-2 text-left text-[11px] font-medium leading-4 text-white shadow-lg ring-1 ring-white/10 dark:bg-slate-100 dark:text-slate-900 ${alignRight ? 'right-0' : 'left-0'}`}>
                    {hint}
                    <span aria-hidden="true" className={`absolute -bottom-1 h-2 w-2 rotate-45 bg-slate-900 dark:bg-slate-100 ${alignRight ? 'right-11' : 'left-11'}`} />
                </span>
            )}
        </div>
    );
}

export default function ClassActionOverlay({
    availability,
    platformLabel,
    direct,
    running,
    busy,
    initializing,
    deleting,
    repairing,
    accountReady,
    canInitialize,
    canRepair,
    repairFailureCount,
    onDelete,
    onInitialize,
    onRepair,
    onCancel
}) {
    const [activeTooltip, setActiveTooltip] = useState(null);
    const dialogRef = useRef(null);
    const cancelRef = useRef(null);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => (cancelRef.current || dialogRef.current)?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [running]);
    const actions = direct ? DIRECT_AVAILABILITY : availability;
    const title = repairing ? '正在修复登录…' : initializing ? '正在初始化系统…' : deleting ? '正在删除班级…' : '系统维护';
    const progressDescription = repairing ? '正在同步平台账号，请稍候'
        : initializing ? '正在清空该平台全部班级数据，请稍候' : '正在同步删除平台班级记录，请稍候';
    const reason = action => actions?.[action] === null ? '' : actions?.[action] || '维护配置未就绪';
    const repairHint = reason('repair') || (repairFailureCount ? `重试上次同步失败的 ${repairFailureCount} 个账号`
        : accountReady ? `${platformLabel}账号已同步，登录异常时可重新同步` : `${platformLabel}账号尚未就绪，可同步账号`);
    const tooltipProps = action => ({
        showTooltip: activeTooltip === action,
        onTooltipChange: show => setActiveTooltip(previous => show ? action : previous === action ? null : previous)
    });

    return (
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-label="系统维护" aria-busy={running}
            onKeyDown={event => {
                if (event.key === 'Escape' && !running) {
                    event.stopPropagation();
                    onCancel(true);
                }
            }}
            className="glass-motion-surface absolute inset-0 z-30 overflow-visible rounded-3xl border border-red-200/50 bg-white/92 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 dark:border-red-900/30 dark:bg-slate-900/92">
            <div className="flex min-h-full flex-col items-center justify-center gap-2 px-3 py-3 text-center">
                <div className={`mb-0.5 flex h-9 w-9 items-center justify-center rounded-full shadow-sm ${running ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60'}`}>
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
                </div>
                <span className="text-xs font-black tracking-tight text-slate-800 dark:text-slate-100">
                    {title}
                </span>
                {running ? (
                    <span role="status" className="max-w-[210px] text-[10px] leading-4 text-slate-500 dark:text-slate-400">{progressDescription}</span>
                ) : (
                    <div className="mt-2 grid w-full max-w-54 grid-cols-2 gap-2">
                        {canRepair && (
                            <MaintenanceButton icon={ShieldCheck} label={repairFailureCount ? '重试失败账号' : '修复登录'} hint={repairHint} {...tooltipProps('repair')}
                                disabled={busy || actions?.repair !== null} tone="from-indigo-600 to-violet-600 shadow-indigo-500/25" onClick={onRepair} />
                        )}
                        <MaintenanceButton icon={Trash2} label="删除班级" hint={reason('delete')} alignRight={canRepair} {...tooltipProps('delete')}
                            disabled={busy || actions?.delete !== null} tone="from-red-600 to-rose-600 shadow-red-500/30" onClick={onDelete} />
                        {canInitialize && (
                            <MaintenanceButton icon={RotateCcw} label="初始化系统" hint={reason('initialize')} alignRight={!canRepair} {...tooltipProps('initialize')}
                                disabled={busy || actions?.initialize !== null} tone="from-orange-500 to-amber-500 shadow-orange-500/30" onClick={onInitialize} />
                        )}
                        <button type="button" ref={cancelRef} onClick={event => onCancel(event.detail === 0)} className="min-h-9 rounded-xl border border-slate-200/60 bg-slate-100 px-3 text-[11px] font-black text-slate-600 transition-all hover:bg-slate-200 active:scale-95 focus-visible:outline-none focus-visible:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:focus-visible:text-indigo-300">
                            取消
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
