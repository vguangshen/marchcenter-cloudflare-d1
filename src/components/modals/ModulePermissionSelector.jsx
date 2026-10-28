import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CalendarDays, CheckCheck, ChevronDown, ChevronRight, Clock, Bot, Eraser } from 'lucide-react';
import { getNowString, incrementPermissionTime, TIME_INCREMENT_OPTIONS } from '../../utils/permissionTime';
import { normalizeAgentPlatforms, normalizePlatformKey, platformLabel } from '../../utils/paasV2Platforms';

const LONG_PRESS_MS = 500;

const TimeIncrementButton = ({ value, onChange, fieldLabel }) => {
    const [expanded, setExpanded] = useState(false);
    const timerRef = useRef(null);
    const longPressedRef = useRef(false);
    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);
    useEffect(() => clearTimer, [clearTimer]);

    const handlePointerDown = event => {
        if (event.pointerType === 'mouse') return;
        clearTimer();
        longPressedRef.current = false;
        timerRef.current = setTimeout(() => {
            longPressedRef.current = true;
            setExpanded(true);
        }, LONG_PRESS_MS);
    };
    const handlePointerEnd = event => {
        if (event.pointerType !== 'mouse') clearTimer();
    };
    const handleClick = event => {
        if (longPressedRef.current) {
            event.preventDefault();
            event.stopPropagation();
            longPressedRef.current = false;
            return;
        }
        if (expanded) {
            setExpanded(false);
            return;
        }
        onChange(incrementPermissionTime(value));
    };

    return (
        <div className="group relative shrink-0" onContextMenu={event => event.preventDefault()}>
            <button type="button" onClick={handleClick} onPointerDown={handlePointerDown} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} className="inline-flex h-7 touch-manipulation select-none items-center whitespace-nowrap rounded px-1.5 text-[10px] font-bold leading-5 text-blue-600 transition hover:bg-blue-50 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-200" aria-label={`${fieldLabel}增加1小时，长按展开固定时长选项`} aria-haspopup="menu" aria-expanded={expanded}>+1小时</button>
            <div className={`absolute right-0 top-full z-50 mt-0 grid w-[9.5rem] grid-cols-3 gap-1 rounded-lg border border-blue-100 bg-white p-1.5 shadow-lg transition-all duration-150 ${expanded ? 'pointer-events-auto visible opacity-100' : 'pointer-events-none invisible opacity-0 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100'}`} role="menu" aria-label={`${fieldLabel}固定时长选项`}>
                {TIME_INCREMENT_OPTIONS.slice(1).map(option => (
                    <button type="button" role="menuitem" key={option.label} onClick={() => {
                        onChange(incrementPermissionTime(value, option.amount, option.unit));
                        longPressedRef.current = false;
                        setExpanded(false);
                    }} className="inline-flex h-7 touch-manipulation select-none items-center justify-center whitespace-nowrap rounded-md px-1.5 text-[10px] font-bold leading-5 text-slate-600 transition hover:bg-blue-50 hover:text-blue-600 focus:bg-blue-50 focus:text-blue-600 focus:outline-none">{option.label}</button>
                ))}
            </div>
        </div>
    );
};

export const BatchPermissionTimeEditor = ({ selectedCount = 0, selectedPlatformCount, selectedAgentCount, unlockTime = '', lockTime = '', onChange, onApply, onClear, disabled = false }) => (
    <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-black text-indigo-800">
                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                <span>统一设置时间</span>
                <span className="font-bold text-indigo-400">{Number.isFinite(selectedPlatformCount) && Number.isFinite(selectedAgentCount) ? `应用到已选 ${selectedPlatformCount} 个平台 · ${selectedAgentCount} 个智能体` : `应用到已选 ${selectedCount} 个模块`}</span>
            </div>
            <button type="button" onClick={onClear} disabled={disabled || selectedCount === 0} className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"><Eraser className="h-3.5 w-3.5" />清空已设时间</button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[['unlockTime', '专属开始时间'], ['lockTime', '专属结束时间']].map(([field, label]) => {
                const value = field === 'unlockTime' ? unlockTime : lockTime;
                return (
                    <label className="min-w-0 space-y-1" key={field}>
                        <span className="flex items-center justify-between gap-2 text-[10px] font-bold leading-5 text-slate-500">
                            <span>{label}</span>
                            <span className="flex shrink-0 items-center gap-1">
                                <button type="button" onClick={() => onChange?.(field, getNowString())} className="inline-flex min-h-7 items-center rounded px-1.5 text-[10px] font-bold text-blue-600 transition hover:bg-blue-50 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-200">此刻</button>
                                <TimeIncrementButton value={value} onChange={time => onChange?.(field, time)} fieldLabel={label} />
                            </span>
                        </span>
                        <input type="datetime-local" value={value || ''} onChange={event => onChange?.(field, event.target.value)} disabled={disabled} className="theme-form-control h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50" />
                    </label>
                );
            })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[9px] leading-4 text-slate-400">未填写的时间项会保留各模块原设置。</span>
            <button type="button" onClick={onApply} disabled={disabled || selectedCount === 0 || (!unlockTime && !lockTime)} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"><CheckCheck className="h-3.5 w-3.5" />应用到已选</button>
        </div>
    </div>
);

const ModulePermissionSelector = ({
    allLinks = [],
    selectedIds = [],
    timeRules = {},
    expandedTimeId = null,
    searchTerm = '',
    agentPlatforms = [],
    onToggleId,
    onUpdateTimeRule,
    onToggleTime
}) => {
    const [expandedPlatforms, setExpandedPlatforms] = useState(() => new Set());
    const [expandedPlatformTimeId, setExpandedPlatformTimeId] = useState(null);
    const platformMap = useMemo(() => new Map(normalizeAgentPlatforms(agentPlatforms).map(platform => [normalizePlatformKey(platform.softwareUnique), platform])), [agentPlatforms]);

    const { regularGroups, agentGroups } = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        const regular = new Map();
        const agents = new Map();
        allLinks.forEach(link => {
            const title = String(link.title || '').toLowerCase();
            if (link.ssoMethod === 'paasV2') {
                const key = normalizePlatformKey(link.paasV2SoftwareUnique || link.softwareUnique || 'PT04') || 'pt04';
                const label = platformLabel(platformMap.get(key), key).toLowerCase();
                if (!agents.has(key)) agents.set(key, []);
                if (!keyword || title.includes(keyword) || label.includes(keyword)) {
                    agents.get(key).push(link);
                }
            } else {
                const category = link.category || '未分类';
                if (!regular.has(category)) regular.set(category, []);
                if (!keyword || title.includes(keyword) || category.toLowerCase().includes(keyword)) {
                    regular.get(category).push(link);
                }
            }
        });
        return {
            regularGroups: [...regular.entries()]
                .filter(([, links]) => links.length > 0)
                .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')),
            agentGroups: [...agents.entries()].filter(([, links]) => links.length > 0).sort(([left], [right]) => {
                const leftPlatform = platformMap.get(left);
                const rightPlatform = platformMap.get(right);
                return (leftPlatform?.sortOrder ?? 10000) - (rightPlatform?.sortOrder ?? 10000) || platformLabel(leftPlatform, left).localeCompare(platformLabel(rightPlatform, right), 'zh-CN');
            })
        };
    }, [allLinks, platformMap, searchTerm]);

    const togglePlatformExpand = key => {
        setExpandedPlatforms(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const togglePlatformTime = key => setExpandedPlatformTimeId(prev => (prev === key ? null : key));

    const togglePlatformAll = links => {
        const ids = links.map(link => link.id);
        if (!ids.length) return;
        const allSelected = ids.every(id => selectedIds.includes(id));
        ids.forEach(id => {
            const selected = selectedIds.includes(id);
            if (allSelected ? selected : !selected) onToggleId(id);
        });
    };

    const renderLinkRow = link => {
        const isSelected = selectedIds.includes(link.id);
        const isTimeExpanded = expandedTimeId === link.id;
        const rule = timeRules[link.id] || {};
        const hasCustomTime = rule.unlockTime || rule.lockTime;

        return (
            <div key={link.id} className={`rounded-xl border transition-all duration-300 ${isSelected ? 'border-indigo-500 bg-indigo-50/20' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className="flex items-center p-3">
                    <label className="flex items-center cursor-pointer flex-grow min-w-0">
                        <input type="checkbox" className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mr-3 flex-shrink-0" checked={isSelected} onChange={() => onToggleId(link.id)} />
                        <div className="flex-1 min-w-0">
                            <div className={`text-sm font-bold break-words ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{link.title}</div>
                            <div className="text-xs text-slate-400 truncate">{link.category || '智能体任务'}</div>
                        </div>
                    </label>
                    {isSelected && (
                        <button type="button" onClick={() => onToggleTime(isTimeExpanded ? null : link.id)} className={`ml-3 p-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${isTimeExpanded || hasCustomTime ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`} title="单独设置该用户的时间门禁">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {hasCustomTime ? <span className="text-[10px] font-bold">已设</span> : <span className="text-[10px]">时间</span>}
                        </button>
                    )}
                </div>
                {isSelected && isTimeExpanded && (
                    <div className="px-3 pb-3 pt-0 animate-in slide-in-from-top-2 duration-200">
                        <div className="bg-white border border-indigo-100 rounded-lg p-3 grid grid-cols-2 gap-3 shadow-sm">
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500">专属开始时间</label>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => onUpdateTimeRule(link.id, 'unlockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                        <TimeIncrementButton value={rule.unlockTime} onChange={value => onUpdateTimeRule(link.id, 'unlockTime', value)} fieldLabel="专属开始时间" />
                                    </div>
                                </div>
                                <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={rule.unlockTime || ''} onChange={e => onUpdateTimeRule(link.id, 'unlockTime', e.target.value)} />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500">专属结束时间</label>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => onUpdateTimeRule(link.id, 'lockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                        <TimeIncrementButton value={rule.lockTime} onChange={value => onUpdateTimeRule(link.id, 'lockTime', value)} fieldLabel="专属结束时间" />
                                    </div>
                                </div>
                                <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={rule.lockTime || ''} onChange={e => onUpdateTimeRule(link.id, 'lockTime', e.target.value)} />
                            </div>
                            <div className="col-span-2 text-[10px] text-slate-400 flex items-center bg-slate-50 p-1.5 rounded">
                                <Clock className="w-3 h-3 mr-1" /> 提示：此处设置将覆盖该模块的全局时间。留空则跟随全局设置。
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {regularGroups.length === 0 && agentGroups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs font-bold text-slate-400">没有找到匹配的模块</div>
            ) : (
            <>
            {regularGroups.map(([category, links]) => (
                <div key={category}>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 pl-2 border-l-4 border-indigo-500/30 flex items-center">
                        {category}
                        <span className="ml-2 bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md text-[10px]">{links.length}</span>
                    </h4>
                    <div className="space-y-3">{links.map(renderLinkRow)}</div>
                </div>
            ))}
            {agentGroups.length > 0 && (
                <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 pl-2 border-l-4 border-violet-500/40 flex items-center">
                        智能体任务
                        <span className="ml-2 bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md text-[10px]">{agentGroups.reduce((sum, [, groupLinks]) => sum + groupLinks.length, 0)}</span>
                    </h4>
                    <div className="space-y-4">
            {agentGroups.map(([key, links]) => {
                const label = platformLabel(platformMap.get(key), key || 'PT04 智能体');
                const ids = links.map(link => link.id);
                const selectedCount = ids.filter(id => selectedIds.includes(id)).length;
                const allSelected = ids.length > 0 && selectedCount === ids.length;
                const expanded = expandedPlatforms.has(key);
                const platformTimeExpanded = expandedPlatformTimeId === key;
                const selectedLinks = links.filter(link => selectedIds.includes(link.id));
                const platformRule = timeRules[selectedLinks[0]?.id] || {};
                const hasPlatformTime = selectedLinks.some(link => {
                    const rule = timeRules[link.id] || {};
                    return rule.unlockTime || rule.lockTime;
                });
                const updatePlatformTime = (type, value) => selectedLinks.forEach(link => onUpdateTimeRule(link.id, type, value));
                return (
                    <div key={`agent-${key}`}>
                        <div className="mb-3 rounded-xl border border-violet-100 bg-violet-50/40 p-2.5">
                            <div className="flex items-center gap-2">
                                <input type="checkbox" aria-label={`选择 ${label} 的全部任务`} className="h-4 w-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500 flex-shrink-0" checked={allSelected} onChange={() => togglePlatformAll(links)} />
                                <button type="button" onClick={() => togglePlatformExpand(key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white"><Bot className="h-3.5 w-3.5" /></span>
                                    <span className="break-words text-sm font-bold text-slate-800">{label}</span>
                                    <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{selectedCount}/{links.length}</span>
                                </button>
                                <button type="button" onClick={() => togglePlatformTime(key)} disabled={selectedCount === 0} aria-label={`设置 ${label} 已选任务的时间门禁`} className={`ml-1 shrink-0 rounded-lg p-1.5 text-xs font-medium transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40 ${platformTimeExpanded || hasPlatformTime ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-100'}`} title="设置该平台已选智能体任务的时间门禁">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    <span className="text-[10px]">{hasPlatformTime ? '已设' : '时间'}</span>
                                </button>
                                <button type="button" onClick={() => togglePlatformExpand(key)} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="展开或收起智能体子任务">
                                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                            </div>
                            {platformTimeExpanded && selectedCount > 0 && (
                                <div className="mt-2 rounded-lg border border-indigo-100 bg-white p-3 grid grid-cols-2 gap-3">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] font-bold text-slate-500">专属开始时间</label>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => updatePlatformTime('unlockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                                <TimeIncrementButton value={platformRule.unlockTime} onChange={value => updatePlatformTime('unlockTime', value)} fieldLabel="专属开始时间" />
                                            </div>
                                        </div>
                                        <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={platformRule.unlockTime || ''} onChange={e => updatePlatformTime('unlockTime', e.target.value)} />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] font-bold text-slate-500">专属结束时间</label>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => updatePlatformTime('lockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                                <TimeIncrementButton value={platformRule.lockTime} onChange={value => updatePlatformTime('lockTime', value)} fieldLabel="专属结束时间" />
                                            </div>
                                        </div>
                                        <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={platformRule.lockTime || ''} onChange={e => updatePlatformTime('lockTime', e.target.value)} />
                                    </div>
                                    <div className="col-span-2 text-[10px] text-slate-400 flex items-center bg-slate-50 p-1.5 rounded">
                                        <Clock className="w-3 h-3 mr-1" /> 提示：此处设置仅会应用到该平台下已选的 {selectedCount} 个智能体任务。
                                    </div>
                                </div>
                            )}
                        </div>
                        {expanded && <div className="space-y-3 pl-1">{links.map(renderLinkRow)}</div>}
                    </div>
                );
            })}
                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
};

export default ModulePermissionSelector;
