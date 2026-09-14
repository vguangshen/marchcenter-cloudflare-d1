import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, Clock, Bot } from 'lucide-react';

const AGENT_PLATFORM_LABELS = {
    KJDZSWRJXT: 'PT0401 · 跨境电子商务人机协同产教融合平台',
    scyxcjrh: 'PT0402 · 市场营销人机协同通用能力平台',
    kjrjxt09: 'PT0403 · 财经人机协同产教融合平台',
    dzswcjrh: 'PT0404 · 电子商务人机协同产教融合平台'
};

const getNowString = () => {
    const now = new Date();
    const pad = n => (n < 10 ? `0${n}` : n);
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const incrementTime = baseTime => {
    const date = baseTime ? new Date(baseTime) : new Date();
    if (Number.isNaN(date.getTime())) {
        const now = new Date();
        now.setHours(now.getHours() + 1);
        const pad = n => (n < 10 ? `0${n}` : n);
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    date.setHours(date.getHours() + 1);
    const pad = n => (n < 10 ? `0${n}` : n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const ModulePermissionSelector = ({
    allLinks = [],
    selectedIds = [],
    timeRules = {},
    expandedTimeId = null,
    searchTerm = '',
    onToggleId,
    onUpdateTimeRule,
    onToggleTime
}) => {
    const [expandedPlatforms, setExpandedPlatforms] = useState(() => new Set());
    const [expandedPlatformTimeId, setExpandedPlatformTimeId] = useState(null);

    const { regularGroups, agentGroups } = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        const regular = {};
        const agents = {};
        allLinks.forEach(link => {
            const title = String(link.title || '').toLowerCase();
            if (link.ssoMethod === 'paasV2') {
                const key = link.paasV2SoftwareUnique || link.softwareUnique || 'PT04';
                const platformLabel = String(AGENT_PLATFORM_LABELS[key] || key || '').toLowerCase();
                if (!agents[key]) agents[key] = [];
                if (!keyword || title.includes(keyword) || platformLabel.includes(keyword)) {
                    agents[key].push(link);
                }
            } else {
                const category = link.category || '未分类';
                if (!regular[category]) regular[category] = [];
                if (!keyword || title.includes(keyword) || category.toLowerCase().includes(keyword)) {
                    regular[category].push(link);
                }
            }
        });
        return {
            regularGroups: Object.entries(regular)
                .filter(([, links]) => links.length > 0)
                .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')),
            agentGroups: Object.entries(agents).filter(([, links]) => links.length > 0)
        };
    }, [allLinks, searchTerm]);

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
                                        <button type="button" onClick={() => onUpdateTimeRule(link.id, 'unlockTime', incrementTime(rule.unlockTime))} className="text-[10px] text-blue-600 hover:underline">+1小时</button>
                                    </div>
                                </div>
                                <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={rule.unlockTime || ''} onChange={e => onUpdateTimeRule(link.id, 'unlockTime', e.target.value)} />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-[10px] font-bold text-slate-500">专属结束时间</label>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => onUpdateTimeRule(link.id, 'lockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                        <button type="button" onClick={() => onUpdateTimeRule(link.id, 'lockTime', incrementTime(rule.lockTime))} className="text-[10px] text-blue-600 hover:underline">+1小时</button>
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
                const label = AGENT_PLATFORM_LABELS[key] || key || 'PT04 智能体';
                const ids = links.map(link => link.id);
                const selectedCount = ids.filter(id => selectedIds.includes(id)).length;
                const allSelected = ids.length > 0 && selectedCount === ids.length;
                const expanded = expandedPlatforms.has(key);
                const platformTimeExpanded = expandedPlatformTimeId === key;
                const platformRule = timeRules[links[0]?.id] || {};
                const hasPlatformTime = links.some(link => {
                    const rule = timeRules[link.id] || {};
                    return rule.unlockTime || rule.lockTime;
                });
                const updatePlatformTime = (type, value) => links.forEach(link => onUpdateTimeRule(link.id, type, value));
                return (
                    <div key={`agent-${key}`}>
                        <div className="mb-3 rounded-xl border border-violet-100 bg-violet-50/40 p-2.5">
                            <div className="flex items-center gap-2">
                                <input type="checkbox" className="h-4 w-4 text-violet-600 rounded border-slate-300 focus:ring-violet-500 flex-shrink-0" checked={allSelected} onChange={() => togglePlatformAll(links)} />
                                <button type="button" onClick={() => togglePlatformExpand(key)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white"><Bot className="h-3.5 w-3.5" /></span>
                                    <span className="break-words text-sm font-bold text-slate-800">{label}</span>
                                    <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{selectedCount}/{links.length}</span>
                                </button>
                                <button type="button" onClick={() => togglePlatformTime(key)} className={`ml-1 shrink-0 rounded-lg p-1.5 text-xs font-medium transition-colors flex items-center gap-1 ${platformTimeExpanded || hasPlatformTime ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-100'}`} title="设置该平台全部智能体任务的时间门禁">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    <span className="text-[10px]">{hasPlatformTime ? '已设' : '时间'}</span>
                                </button>
                                <button type="button" onClick={() => togglePlatformExpand(key)} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="展开或收起智能体子任务">
                                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                            </div>
                            {platformTimeExpanded && (
                                <div className="mt-2 rounded-lg border border-indigo-100 bg-white p-3 grid grid-cols-2 gap-3">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] font-bold text-slate-500">专属开始时间</label>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => updatePlatformTime('unlockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                                <button type="button" onClick={() => updatePlatformTime('unlockTime', incrementTime(platformRule.unlockTime))} className="text-[10px] text-blue-600 hover:underline">+1小时</button>
                                            </div>
                                        </div>
                                        <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={platformRule.unlockTime || ''} onChange={e => updatePlatformTime('unlockTime', e.target.value)} />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[10px] font-bold text-slate-500">专属结束时间</label>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => updatePlatformTime('lockTime', getNowString())} className="text-[10px] text-blue-600 hover:underline">此刻</button>
                                                <button type="button" onClick={() => updatePlatformTime('lockTime', incrementTime(platformRule.lockTime))} className="text-[10px] text-blue-600 hover:underline">+1小时</button>
                                            </div>
                                        </div>
                                        <input type="datetime-local" className="theme-form-control w-full text-xs p-1.5 border border-slate-200 rounded bg-slate-50 text-slate-600 focus:border-indigo-500 outline-none" value={platformRule.lockTime || ''} onChange={e => updatePlatformTime('lockTime', e.target.value)} />
                                    </div>
                                    <div className="col-span-2 text-[10px] text-slate-400 flex items-center bg-slate-50 p-1.5 rounded">
                                        <Clock className="w-3 h-3 mr-1" /> 提示：此处设置会应用到该平台下全部智能体子任务。
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