import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Bot, RefreshCw, CheckSquare, Square, Inbox, Loader2, Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { GLASS_INPUT, PRIMARY_BTN } from '../../constants/config';
import { api } from '../../utils/api';
import { notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { parseSsoConfig } from './competitionEditConfig';

const SOFTWARE_OPTIONS = [
    { id: 'PT0401', softwareUnique: 'KJDZSWRJXT', name: '跨境电子商务人机协同产教融合平台' },
    { id: 'PT0402', softwareUnique: 'scyxcjrh', name: '市场营销人机协同通用能力平台' },
    { id: 'PT0403', softwareUnique: 'kjrjxt09', name: '财经人机协同产教融合平台' },
    { id: 'PT0404', softwareUnique: 'dzswcjrh', name: '电子商务人机协同产教融合平台' }
];

const TASK_ANSWER_TYPE = '1';
const CATALOG_CACHE_PREFIX = 'marchcenter:paas-v2:catalog:';
const CATALOG_CACHE_VERSION = 5;

const CUSTOM_PLATFORMS_KEY = 'marchcenter:paas-v2:custom-platforms';
const BUILTIN_OVERRIDES_KEY = 'marchcenter:paas-v2:builtin-overrides';

function readBuiltinOverrides() {
    try {
        const raw = localStorage.getItem(BUILTIN_OVERRIDES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}

function writeBuiltinOverrides(map) {
    try { localStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(map || {})); } catch { /* ignore */ }
}

function readCustomPlatforms() {
    try {
        const raw = localStorage.getItem(CUSTOM_PLATFORMS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(item => item && item.softwareUnique)
            .map(item => ({ code: String(item.code || '').trim(), name: String(item.name || '').trim(), softwareUnique: String(item.softwareUnique).trim() }))
            .filter(item => item.softwareUnique);
    } catch { return []; }
}

function writeCustomPlatforms(list) {
    try { localStorage.setItem(CUSTOM_PLATFORMS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function readCatalogCache(softwareUnique) {
    try {
        const raw = localStorage.getItem(`${CATALOG_CACHE_PREFIX}${softwareUnique}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== CATALOG_CACHE_VERSION || !Array.isArray(parsed.tasks)) return null;
        return parsed.tasks;
    } catch { return null; }
}

function writeCatalogCache(softwareUnique, tasks) {
    try {
        localStorage.setItem(`${CATALOG_CACHE_PREFIX}${softwareUnique}`, JSON.stringify({ version: CATALOG_CACHE_VERSION, tasks }));
    } catch { /* storage unavailable */ }
}

function normalizeStoredTasks(links = []) {
    const keys = new Set();
    for (const link of links) {
        if (link.ssoMethod !== 'paasV2') continue;
        const plugFlag = link.paasV2PlugFlag || link.plugFlag;
        const softwareUnique = link.paasV2SoftwareUnique || link.softwareUnique;
        if (plugFlag && softwareUnique) keys.add(`${softwareUnique}:${plugFlag}`);
    }
    return keys;
}

const LONG_PRESS_MS = 500;

function PlatformCard({ item, active, armed, status = 'red', onSelect, onDisarm, onLongPress, onEdit, onDelete }) {
    const timerRef = useRef(null);
    const suppressClickRef = useRef(false);
    const startRef = useRef({ x: 0, y: 0 });

    const clearTimer = () => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };

    const handlePointerDown = event => {
        startRef.current = { x: event.clientX, y: event.clientY };
        suppressClickRef.current = false;
        clearTimer();
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            suppressClickRef.current = true;
            onLongPress(item);
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = event => {
        if (!timerRef.current) return;
        const dx = event.clientX - startRef.current.x;
        const dy = event.clientY - startRef.current.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimer();
    };

    const handlePointerEnd = () => clearTimer();
    const handleClick = () => {
        if (suppressClickRef.current) return;
        if (armed) { onDisarm(); return; }
        onSelect(item);
    };

    return (
        <div role="button" tabIndex={0} onClick={handleClick} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') handleClick(); }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onPointerLeave={handlePointerEnd} className={`relative min-w-[172px] shrink-0 cursor-pointer rounded-2xl border p-3 text-left transition select-none touch-pan-x ${armed ? 'card-delete-armed ring-4 ring-red-400/80' : active ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40'}`}>
            <b className="flex items-center gap-1.5 text-xs text-slate-800"><span className="truncate">{item.id}</span><span className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === 'green' ? 'bg-emerald-500' : status === 'yellow' ? 'bg-yellow-400' : 'bg-red-500'}`} /></b>
            <small className="mt-1 block text-[9px] leading-4 text-slate-400">{item.name}</small>
            {armed && (
                <div className="absolute right-2 top-2 z-10 flex gap-1">
                    <button type="button" onClick={event => { event.stopPropagation(); onEdit(item); }} className="rounded-lg border border-slate-200 bg-white/90 p-1.5 text-indigo-600 shadow-sm hover:bg-indigo-50"><Edit2 className="h-3 w-3" /></button>
                    <button type="button" onClick={event => { event.stopPropagation(); onDelete(item); }} className="rounded-lg border border-slate-200 bg-white/90 p-1.5 text-red-600 shadow-sm hover:bg-red-50"><Trash2 className="h-3 w-3" /></button>
                </div>
            )}
        </div>
    );
}

const TaskAppModal = ({ isOpen, onClose, onSave, onPlatformsChange = () => {}, initialData = null, initialSoftwareUnique = '', ssoConfigs = [], existingLinks = [] }) => {
    const dialogRef = useModalAccessibility(isOpen, onClose);
    const paasConfig = useMemo(() => {
        const row = ssoConfigs.find(item => parseSsoConfig(item).method === 'paasV2');
        return row ? parseSsoConfig(row) : {};
    }, [ssoConfigs]);
    const storedKeys = useMemo(() => normalizeStoredTasks(existingLinks), [existingLinks]);

    const [softwareUnique, setSoftwareUnique] = useState('scyxcjrh');
    const [catalogTasks, setCatalogTasks] = useState([]);
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(null);
    const catalogRequestRef = useRef(0);
    const [manualPlatform, setManualPlatform] = useState({ code: '', name: '', softwareUnique: '' });
    const [showManual, setShowManual] = useState(false);
    const [armedSoftwareUnique, setArmedSoftwareUnique] = useState(null);
    const [builtinOverrides, setBuiltinOverrides] = useState(readBuiltinOverrides);
    const [editingBuiltin, setEditingBuiltin] = useState(false);
    const [editingSoftwareUnique, setEditingSoftwareUnique] = useState(null);
    const [customPlatforms, setCustomPlatforms] = useState(readCustomPlatforms);
    const catalogPlatformRef = useRef({ code: '', name: softwareUnique });

    const [formData, setFormData] = useState({
        title: '',
        subtitle: '',
        url: '',
        category: '智能体任务',
        statusText: '长期开放',
        description: '',
        color: 'violet',
        plugFlag: '',
        answerType: TASK_ANSWER_TYPE,
        softwareUnique: 'scyxcjrh',
        cover: ''
    });

    useEffect(() => {
        if (!isOpen) return;
        setFormData({
            title: initialData?.title || '',
            subtitle: initialData?.subtitle || '',
            url: initialData?.url || paasConfig.jumpBaseUrl || '',
            category: initialData?.category || '智能体任务',
            statusText: initialData?.statusText || '长期开放',
            description: initialData?.description || '',
            color: initialData?.color || 'violet',
            plugFlag: initialData?.paasV2PlugFlag || initialData?.plugFlag || '',
            answerType: initialData?.paasV2AnswerType || initialData?.answerType || TASK_ANSWER_TYPE,
            softwareUnique: initialData?.paasV2SoftwareUnique || initialData?.softwareUnique || 'scyxcjrh',
            cover: initialData?.paasV2Cover || initialData?.cover || ''
        });
        setSelectedKeys(new Set());
        setCatalogTasks([]);
        setCatalogError('');
        if (!initialData?.id) {
            setSoftwareUnique(initialSoftwareUnique || paasConfig.productModuleId || 'scyxcjrh');
        }
    }, [initialData, initialSoftwareUnique, isOpen, paasConfig]);

    useEffect(() => {
        const builtin = SOFTWARE_OPTIONS.find(item => item.softwareUnique === softwareUnique);
        const builtinOverride = builtin ? builtinOverrides[softwareUnique] : null;
        const custom = customPlatforms.find(item => item.softwareUnique === softwareUnique);
        catalogPlatformRef.current = builtin
            ? { code: builtinOverride?.code || builtin.id, name: builtinOverride?.name || builtin.name }
            : (custom
                ? { code: custom.code || '', name: custom.name || '' }
                : (manualPlatform.softwareUnique === softwareUnique
                    ? { code: manualPlatform.code || '', name: manualPlatform.name || '' }
                    : { code: '', name: softwareUnique }));
    }, [softwareUnique, manualPlatform, customPlatforms, builtinOverrides]);

    const allPlatforms = useMemo(() => {
        const seen = new Set();
        const merged = [];
        for (const item of SOFTWARE_OPTIONS) {
            if (!seen.has(item.softwareUnique)) {
                seen.add(item.softwareUnique);
                const override = builtinOverrides[item.softwareUnique];
                merged.push({ ...item, id: override?.code || item.id, name: override?.name || item.name, builtin: true });
            }
        }
        for (const item of customPlatforms) {
            if (!seen.has(item.softwareUnique)) {
                seen.add(item.softwareUnique);
                merged.push({ id: item.code || item.softwareUnique, softwareUnique: item.softwareUnique, name: item.name || item.softwareUnique, builtin: false });
            }
        }
        return merged;
    }, [customPlatforms, builtinOverrides]);

    const catalogCounts = useMemo(() => {
        const counts = {};
        for (const platform of allPlatforms) {
            const cached = readCatalogCache(platform.softwareUnique);
            if (cached) counts[platform.softwareUnique] = cached.length;
        }
        if (catalogTasks.length) counts[softwareUnique] = catalogTasks.length;
        return counts;
    }, [allPlatforms, softwareUnique, catalogTasks]);

    const importedCounts = useMemo(() => {
        const counts = {};
        for (const key of storedKeys) {
            const separator = key.indexOf(':');
            const su = separator >= 0 ? key.slice(0, separator) : key;
            counts[su] = (counts[su] || 0) + 1;
        }
        return counts;
    }, [storedKeys]);

    const platformStatus = useCallback(su => {
        const total = catalogCounts[su] || 0;
        const imported = importedCounts[su] || 0;
        if (total > 0) {
            if (imported === 0) return 'red';
            if (imported >= total) return 'green';
            return 'yellow';
        }
        return imported > 0 ? 'yellow' : 'red';
    }, [catalogCounts, importedCounts]);

    const loadCatalog = useCallback(async ({ force = false } = {}) => {
        if (initialData?.id) return;
        const requestId = catalogRequestRef.current + 1;
        catalogRequestRef.current = requestId;

        if (!force) {
            const cached = readCatalogCache(softwareUnique);
            if (cached) {
                setCatalogTasks(cached);
                setSelectedKeys(new Set(cached.filter(task => !storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).map(task => task.plugFlag)));
                setCatalogError('');
                setCatalogLoading(false);
                return;
            }
        }

        setCatalogLoading(true);
        setCatalogError('');
        try {
            const params = new URLSearchParams({ softwareUnique });
            const platform = catalogPlatformRef.current || {};
            if (platform.code) params.set('platformCode', platform.code);
            if (platform.name) params.set('platformName', platform.name);
            const data = await api.get(`/paas-v2/catalog?${params.toString()}`, {
                fallback: '智能体任务目录读取失败',
                timeoutMs: 120_000
            });
            if (catalogRequestRef.current !== requestId) return;
            const tasks = Array.isArray(data.tasks) ? data.tasks : [];
            writeCatalogCache(softwareUnique, tasks);
            setCatalogTasks(tasks);
            setSelectedKeys(new Set(tasks.filter(task => !storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).map(task => task.plugFlag)));
        } catch (error) {
            if (catalogRequestRef.current !== requestId) return;
            setCatalogError(error.message || '智能体任务目录读取失败');
        } finally {
            if (catalogRequestRef.current === requestId) setCatalogLoading(false);
        }
    }, [initialData?.id, softwareUnique, storedKeys]);

    useEffect(() => {
        if (isOpen && !initialData?.id) loadCatalog();
    }, [isOpen, initialData?.id, loadCatalog]);

    const renderCatalogList = () => {
        if (catalogLoading) {
            return <div className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-xs font-bold text-slate-400">正在读取任务目录…</div>;
        }
        if (catalogTasks.length === 0) {
            return <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 text-slate-400"><Inbox className="h-8 w-8" /><span className="mt-2 text-xs font-bold">没有可导入的任务</span></div>;
        }
        return <div className="grid gap-2 sm:grid-cols-2">{catalogTasks.map(task => {
            const already = storedKeys.has(`${softwareUnique}:${task.plugFlag}`);
            const checked = selectedKeys.has(task.plugFlag);
            return <button type="button" key={task.plugFlag} disabled={already} onClick={() => toggleTask(task.plugFlag)} className={`group flex min-h-[76px] items-start gap-3 rounded-2xl border p-3 text-left transition ${already ? 'cursor-default border-emerald-100 bg-emerald-50/60 opacity-70' : checked ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40'}`}>
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}>{checked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5 text-slate-400" />}</span>
                <span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{task.title}</b><small className="mt-1 block font-mono text-[9px] text-slate-400">plugFlag {task.plugFlag}</small><small className="mt-0.5 block text-[9px] text-slate-400">answerType {task.answerType}</small></span>
                {already && <span className="mt-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[8px] font-black text-emerald-700">已导入</span>}
            </button>;
        })}</div>;
    };

    if (!isOpen) return null;

    const update = (key, value) => setFormData(current => ({ ...current, [key]: value }));

    const toggleTask = plugFlag => {
        setSelectedKeys(current => {
            const next = new Set(current);
            if (next.has(plugFlag)) next.delete(plugFlag); else next.add(plugFlag);
            return next;
        });
    };

    const openManual = () => {
        setEditingSoftwareUnique(null);
        setEditingBuiltin(false);
        setManualPlatform({ code: '', name: '', softwareUnique: '' });
        setShowManual(true);
    };

    const saveManualPlatform = () => {
        const code = manualPlatform.code.trim();
        const name = manualPlatform.name.trim();
        const nextSoftwareUnique = manualPlatform.softwareUnique.trim();
        if (!code || !name || !nextSoftwareUnique) {
            notify('请填写软件代码、软件名称和 softwareUnique', 'warning');
            return;
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(nextSoftwareUnique)) {
            notify('softwareUnique 仅支持字母、数字、点、下划线和中划线', 'warning');
            return;
        }
        if (editingBuiltin) {
            const nextOverrides = { ...builtinOverrides, [editingSoftwareUnique]: { code, name } };
            setBuiltinOverrides(nextOverrides);
            writeBuiltinOverrides(nextOverrides);
            setSoftwareUnique(editingSoftwareUnique);
            setEditingSoftwareUnique(null);
            setEditingBuiltin(false);
            setShowManual(false);
            onPlatformsChange();
            notify('内置平台信息已更新', 'success');
            return;
        }
        if (SOFTWARE_OPTIONS.some(item => item.softwareUnique === nextSoftwareUnique)) {
            notify('该 softwareUnique 已在预设平台中', 'warning');
            return;
        }
        const next = [...customPlatforms.filter(item => item.softwareUnique !== nextSoftwareUnique && item.softwareUnique !== editingSoftwareUnique), { code, name, softwareUnique: nextSoftwareUnique }];
        setCustomPlatforms(next);
        writeCustomPlatforms(next);
        setSoftwareUnique(nextSoftwareUnique);
        setEditingSoftwareUnique(null);
        setEditingBuiltin(false);
        setShowManual(false);
        onPlatformsChange();
        notify('软件平台已保存', 'success');
    };

    const applyManualPlatform = () => {
        const nextSoftwareUnique = manualPlatform.softwareUnique.trim();
        if (!nextSoftwareUnique) {
            notify('请输入 softwareUnique', 'warning');
            return;
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(nextSoftwareUnique)) {
            notify('softwareUnique 仅支持字母、数字、点、下划线和中划线', 'warning');
            return;
        }
        setSoftwareUnique(nextSoftwareUnique);
        setShowManual(false);
    };

    const armPlatform = item => { setArmedSoftwareUnique(item.softwareUnique); };
    const disarmPlatform = () => setArmedSoftwareUnique(null);

    const editPlatform = item => {
        setEditingSoftwareUnique(item.softwareUnique);
        setEditingBuiltin(Boolean(item.builtin));
        setManualPlatform({ code: item.id || item.code || '', name: item.name || '', softwareUnique: item.softwareUnique });
        setArmedSoftwareUnique(null);
        setShowManual(true);
    };

    const deletePlatform = item => {
        if (item.builtin) { notify('内置平台不可删除', 'warning'); return; }
        const next = customPlatforms.filter(platform => platform.softwareUnique !== item.softwareUnique);
        setCustomPlatforms(next);
        writeCustomPlatforms(next);
        if (softwareUnique === item.softwareUnique) setSoftwareUnique(SOFTWARE_OPTIONS[0].softwareUnique);
        setArmedSoftwareUnique(null);
        onPlatformsChange();
        notify('平台已删除', 'success');
    };

    const toggleAll = () => {
        setSelectedKeys(current => {
            if (current.size === catalogTasks.filter(task => !storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).length) return new Set();
            return new Set(catalogTasks.filter(task => !storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).map(task => task.plugFlag));
        });
    };

    const selectedCount = catalogTasks.filter(task => selectedKeys.has(task.plugFlag) && !storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).length;
    const alreadyImportedCount = catalogTasks.filter(task => storedKeys.has(`${softwareUnique}:${task.plugFlag}`)).length;

    const saveSingle = async () => {
        if (!formData.title || !formData.plugFlag || !formData.url || !formData.softwareUnique) {
            notify('请填写任务名称、跳转地址、任务编码和软件标识', 'warning');
            return;
        }
        const payload = {
            title: formData.title,
            subtitle: formData.subtitle,
            url: formData.url,
            category: formData.category,
            statusText: formData.statusText,
            description: formData.description,
            color: formData.color,
            ssoMethod: 'paasV2',
            paasV2PlugFlag: formData.plugFlag,
            paasV2AnswerType: formData.answerType,
            paasV2SoftwareUnique: formData.softwareUnique,
            paasV2Cover: formData.cover
        };
        try {
            if (initialData?.id) await api.put(`/competitions/${initialData.id}`, payload, { fallback: '智能体任务更新失败' });
            else await api.post('/competitions', payload, { fallback: '智能体任务新增失败' });
            onSave?.();
            notify(initialData?.id ? '智能体任务已更新' : '智能体任务已新增', 'success');
            onClose();
        } catch (error) {
            notify(error.message || '保存失败', 'error');
        }
    };

    const importSelected = async () => {
        if (!selectedCount) {
            notify('请至少选择一个未导入的任务', 'warning');
            return;
        }
        setImporting(true);
        try {
            const selectedTasks = catalogTasks.filter(task => selectedKeys.has(task.plugFlag) && !storedKeys.has(`${softwareUnique}:${task.plugFlag}`));
            const remoteCovers = [...new Set(selectedTasks.map(task => task.cover).filter(Boolean))];
            let coverMap = {};
            setImportProgress({ total: selectedTasks.length, done: 0, failed: 0, phase: remoteCovers.length ? 'cover' : 'tasks' });
            if (remoteCovers.length) {
                const cached = await api.post('/paas-v2/covers/cache', { urls: remoteCovers }, {
                    fallback: '智能体封面缓存失败',
                    timeoutMs: 180_000,
                    retry: 0
                });
                coverMap = cached?.covers || {};
            }
            let done = 0;
            let failed = 0;
            setImportProgress({ total: selectedTasks.length, done, failed, phase: 'tasks' });
            for (const task of selectedTasks) {
                try {
                    await api.post('/competitions', {
                        title: task.title,
                        subtitle: '',
                        url: task.trainJumpPath || paasConfig.jumpBaseUrl || '',
                        category: (catalogPlatformRef.current?.name) || '智能体任务',
                        statusText: '长期开放',
                        description: task.introduce || '',
                        color: 'violet',
                        ssoMethod: 'paasV2',
                        paasV2PlugFlag: task.plugFlag,
                        paasV2AnswerType: TASK_ANSWER_TYPE,
                        paasV2SoftwareUnique: softwareUnique,
                        paasV2Cover: task.cover ? (coverMap[task.cover] || task.cover) : ''
                    }, { fallback: '智能体任务导入失败', retry: 0 });
                    done += 1;
                } catch {
                    failed += 1;
                }
                setImportProgress({ total: selectedTasks.length, done, failed, phase: 'tasks' });
            }
            onSave?.();
            if (failed === 0) notify(`已导入 ${selectedTasks.length} 个智能体任务`, 'success');
            else notify(`导入完成：成功 ${done} 个，失败 ${failed} 个`, 'warning');
            onClose();
        } catch (error) {
            notify(error.message || '导入失败', 'error');
        } finally {
            setImporting(false);
            setImportProgress(null);
        }
    };

    return (
        <>
        <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref={dialogRef} className="w-full max-w-3xl rounded-[28px] border border-white/70 bg-white/95 p-6 shadow-2xl dark:bg-slate-900/95">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-600"><Bot className="h-5 w-5" /></span>
                        <div><h2 className="text-lg font-black text-slate-900 dark:text-white">{initialData?.id ? '编辑智能体任务' : '新增智能体任务'}</h2><p className="text-[10px] text-slate-400">{initialData?.id ? '修改单个 task_app 卡片' : '按 PT04 平台任务目录批量导入 task_app 卡片'}</p></div>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                {initialData?.id ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">任务名称</span><input value={formData.title} onChange={e => update('title', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">副标题</span><input value={formData.subtitle} onChange={e => update('subtitle', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">封面图片 Cover URL</span><input value={formData.cover} onChange={e => update('cover', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} placeholder="选填，例如 https://resource.zuoyizuo.com/..." /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">跳转地址 trainJumpPath</span><input value={formData.url} onChange={e => update('url', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">任务编码 plugFlag</span><input value={formData.plugFlag} onChange={e => update('plugFlag', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">答题类型 answerType</span><select value={formData.answerType} onChange={e => update('answerType', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">软件标识 softwareUnique</span><select value={formData.softwareUnique} onChange={e => update('softwareUnique', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`}>{SOFTWARE_OPTIONS.map(item => <option key={item.id} value={item.softwareUnique}>{item.id} · {item.name}</option>)}{!SOFTWARE_OPTIONS.some(item => item.softwareUnique === formData.softwareUnique) && <option value={formData.softwareUnique}>{formData.softwareUnique} · 自定义</option>}</select></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">分类</span><input value={formData.category} onChange={e => update('category', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">状态文字</span><input value={formData.statusText} onChange={e => update('statusText', e.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                    </div>
                ) : (
                    <div className="mt-5">
                        <div className="space-y-3">
                            <div className="flex gap-2 overflow-x-auto pb-2">{allPlatforms.map(item => <PlatformCard key={item.softwareUnique} item={item} active={softwareUnique === item.softwareUnique} armed={armedSoftwareUnique === item.softwareUnique} status={platformStatus(item.softwareUnique)} onSelect={selected => setSoftwareUnique(selected.softwareUnique)} onDisarm={disarmPlatform} onLongPress={armPlatform} onEdit={editPlatform} onDelete={deletePlatform} />)}<button type="button" onClick={openManual} className="grid h-[72px] w-[96px] shrink-0 place-items-center rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 text-violet-500 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"><Plus className="h-5 w-5" /></button></div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-bold text-slate-400">共 {catalogTasks.length} 个任务，已导入 {alreadyImportedCount} 个，选中 {selectedCount} 个</span>
                                <button type="button" onClick={() => loadCatalog({ force: true })} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
                            </div>
                        </div>
                        {catalogError && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{catalogError}</p>}
                        <div className="mt-4 max-h-[420px] overflow-y-auto rounded-2xl border border-slate-100">
                            <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-2">
                                <button type="button" onClick={toggleAll} className="flex items-center gap-2 text-[10px] font-bold text-violet-600"><CheckSquare className="h-4 w-4" />全选未导入</button>
                                <span className="text-[10px] text-slate-400">PT04 智能体 task_app 目录</span>
                            </div>
                            {renderCatalogList()}
                        </div>
                    </div>
                )}

                {importing && importProgress && (
                    <div className="mt-4">
                        <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold text-slate-500">
                            <span>{importProgress.phase === 'cover' ? '正在缓存任务封面…' : `正在导入任务 ${importProgress.done}/${importProgress.total}`}</span>
                            <span>{importProgress.phase === 'cover' ? '' : `${Math.round((importProgress.done / Math.max(importProgress.total, 1)) * 100)}%`}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all ${importProgress.phase === 'cover' ? 'w-full animate-pulse' : ''}`} style={importProgress.phase === 'cover' ? undefined : { width: `${Math.round((importProgress.done / Math.max(importProgress.total, 1)) * 100)}%` }} />
                        </div>
                        {importProgress.failed > 0 && <p className="mt-1 text-[10px] font-bold text-red-500">已失败 {importProgress.failed} 个</p>}
                    </div>
                )}
                <div className="mt-6 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">取消</button>
                    {initialData?.id
                        ? <button type="button" onClick={saveSingle} className={`${PRIMARY_BTN} inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold`}><Save className="h-3.5 w-3.5" />保存</button>
                        : <button type="button" onClick={importSelected} disabled={importing || !selectedCount} className={`${PRIMARY_BTN} inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-60`}>{importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{importing ? '导入中…' : '导入所选任务'}</button>}
                </div>
            </div>
        </div>
        {showManual && (
            <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setShowManual(false); }}>
                <div className="w-full max-w-md rounded-[24px] border border-white/70 bg-white/95 p-6 shadow-2xl dark:bg-slate-900/95">
                    <div className="flex items-center justify-between gap-4">
                        <div><h3 className="text-base font-black text-slate-900 dark:text-white">{editingBuiltin ? '编辑内置平台' : editingSoftwareUnique ? '编辑软件平台' : '手动添加软件'}</h3><p className="text-[10px] text-slate-400">{editingBuiltin ? '可修改软件代码与名称，softwareUnique 保持不变' : editingSoftwareUnique ? '修改软件代码、软件名称与 softwareUnique' : '填写软件代码、软件名称与 softwareUnique'}</p></div>
                        <button type="button" onClick={() => setShowManual(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                    </div>
                    <div className="mt-5 space-y-3">
                        <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-500">软件代码</span><input value={manualPlatform.code} onChange={e => setManualPlatform(current => ({ ...current, code: e.target.value }))} placeholder="例如 PT0405" className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-500">软件名称</span><input value={manualPlatform.name} onChange={e => setManualPlatform(current => ({ ...current, name: e.target.value }))} placeholder="例如 物流人机协同产教融合平台" className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>
                        <label className="block space-y-1"><span className="text-[10px] font-bold text-slate-500">softwareUnique</span><input value={manualPlatform.softwareUnique} onChange={e => setManualPlatform(current => ({ ...current, softwareUnique: e.target.value }))} placeholder="输入 softwareUnique" disabled={editingBuiltin} className={`${GLASS_INPUT} h-10 w-full px-3 ${editingBuiltin ? 'disabled:bg-slate-100 disabled:opacity-60' : ''}`} /></label>
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                        <button type="button" onClick={() => setShowManual(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600">取消</button>
                        <button type="button" onClick={saveManualPlatform} className={`${PRIMARY_BTN} inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold`}><Save className="h-3.5 w-3.5" />{editingBuiltin ? '保存信息' : '保存平台'}</button>
                        {!editingBuiltin && <button type="button" onClick={applyManualPlatform} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100"><Search className="h-3.5 w-3.5" />获取任务列表</button>}
                    </div>
                </div>
            </div>
        )}
        </>

    );
};

export default TaskAppModal;