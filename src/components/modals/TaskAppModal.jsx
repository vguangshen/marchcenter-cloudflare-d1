import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Bot, RefreshCw, CheckSquare, Square, Inbox, Loader2, Plus, Edit2, Trash2, Ellipsis, Cloud, Eraser } from 'lucide-react';
import { GLASS_INPUT } from '../../constants/config';
import { api } from '../../utils/api';
import { confirmAction, notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { parseSsoConfig } from './competitionEditConfig';
import {
    AGENT_PLATFORM_THEMES, DEFAULT_AGENT_PLATFORMS, DEFAULT_AGENT_PLATFORM_THEME,
    getAgentPlatformTheme, normalizeAgentPlatforms, normalizeAgentPlatformTheme, normalizePlatformKey
} from '../../utils/paasV2Platforms';

const DEFAULT_ANSWER_TYPE = '1,2,3,4';
const EMPTY_ITEMS = Object.freeze([]);
const samePlatform = (left, right) => normalizePlatformKey(left) !== '' && normalizePlatformKey(left) === normalizePlatformKey(right);
const taskKey = (softwareUnique, plugFlag) => `${normalizePlatformKey(softwareUnique)}\u0000${normalizePlatformKey(plugFlag)}`;

function normalizeStoredTasks(links) {
    return new Set(links.filter(link => link.ssoMethod === 'paasV2')
        .filter(link => (link.paasV2PlugFlag || link.plugFlag) && (link.paasV2SoftwareUnique || link.softwareUnique))
        .map(link => taskKey(link.paasV2SoftwareUnique || link.softwareUnique, link.paasV2PlugFlag || link.plugFlag)));
}

function PlatformCard({ item, active, menuOpen, status, disabled, onSelect, onToggleMenu, onEdit, onDelete }) {
    const theme = getAgentPlatformTheme(item.theme);
    return <div className={`relative min-w-[184px] shrink-0 rounded-2xl border transition ${active ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40'} ${disabled ? 'opacity-60' : ''}`}>
        <button type="button" disabled={disabled} onClick={() => onSelect(item)} aria-pressed={active} className="block w-full rounded-2xl p-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
            <b className="flex items-center gap-1.5 text-xs text-slate-800"><span className="truncate">{item.code}</span><span className={`inline-block h-2 w-2 shrink-0 rounded-full ${status === 'green' ? 'bg-emerald-500' : status === 'yellow' ? 'bg-yellow-400' : 'bg-red-500'}`} /></b>
            <small className="mt-1 block truncate text-[9px] leading-4 text-slate-400" title={item.name}>{item.name}</small>
            <span className="mt-1.5 inline-flex items-center gap-1 text-[8px] font-bold text-slate-400"><i className="h-2 w-2 rounded-full" style={{ background: theme.gradient }} />{theme.label}</span>
        </button>
        {!menuOpen ? <button type="button" disabled={disabled} onClick={() => onToggleMenu(item)} aria-label={`管理软件平台 ${item.name}`} aria-expanded={false} className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><Ellipsis className="h-4 w-4" /></button>
            : <div className="absolute right-2 top-2 z-20 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-lg" role="group" aria-label={`${item.name} 平台操作`}>
                <button type="button" disabled={disabled} onClick={() => onEdit(item)} aria-label={`编辑 ${item.name}`} className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"><Edit2 className="h-3.5 w-3.5" /></button>
                <button type="button" disabled={disabled} onClick={() => onDelete(item)} aria-label={`删除 ${item.name}`} className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                <button type="button" disabled={disabled} onClick={() => onToggleMenu(item)} aria-label={`关闭 ${item.name} 平台操作`} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
            </div>}
    </div>;
}

const TaskAppModal = ({ isOpen, onClose, onSave, onPlatformsChange = () => {}, platforms = DEFAULT_AGENT_PLATFORMS, initialData = null, initialSoftwareUnique = '', initialPlatformSoftwareUnique = '', ssoConfigs = EMPTY_ITEMS, existingLinks = EMPTY_ITEMS }) => {
    const paasConfig = useMemo(() => {
        const row = ssoConfigs.find(item => parseSsoConfig(item).method === 'paasV2');
        return row ? parseSsoConfig(row) : {};
    }, [ssoConfigs]);
    const paasConfigRef = useRef(paasConfig);
    paasConfigRef.current = paasConfig;
    const storedKeys = useMemo(() => normalizeStoredTasks(existingLinks), [existingLinks]);
    const allPlatforms = useMemo(() => normalizeAgentPlatforms(platforms), [platforms]);
    const [softwareUnique, setSoftwareUnique] = useState('scyxcjrh');
    const [catalogTasks, setCatalogTasks] = useState([]);
    const [selectedKeys, setSelectedKeys] = useState(() => new Set());
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [catalogFallback, setCatalogFallback] = useState(false);
    const [importing, setImporting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [importProgress, setImportProgress] = useState(null);
    const [manualPlatform, setManualPlatform] = useState({ code: '', name: '', softwareUnique: '', theme: DEFAULT_AGENT_PLATFORM_THEME });
    const [showManual, setShowManual] = useState(false);
    const [menuSoftwareUnique, setMenuSoftwareUnique] = useState(null);
    const [editingBuiltin, setEditingBuiltin] = useState(false);
    const [editingSoftwareUnique, setEditingSoftwareUnique] = useState(null);
    const [platformSaving, setPlatformSaving] = useState(false);
    const catalogRequestRef = useRef(0);
    const catalogAbortRef = useRef(null);
    const initialPlatformRef = useRef('');
    const catalogPlatform = useMemo(() => allPlatforms.find(item => samePlatform(item.softwareUnique, softwareUnique)), [allPlatforms, softwareUnique]);
    const [formData, setFormData] = useState({});
    const operationRef = useRef(false);
    const busy = importing || saving || platformSaving;
    const closeMain = useCallback(() => { if (!busy && !operationRef.current) onClose(); }, [busy, onClose]);
    const closeManual = useCallback(() => { if (!platformSaving && !operationRef.current) setShowManual(false); }, [platformSaving]);
    const dialogRef = useModalAccessibility(isOpen && !showManual, closeMain);
    const manualDialogRef = useModalAccessibility(isOpen && showManual, closeManual);
    const resetCatalog = useCallback(() => {
        catalogRequestRef.current += 1;
        catalogAbortRef.current?.abort();
        catalogAbortRef.current = null;
        setCatalogTasks([]); setSelectedKeys(new Set()); setCatalogLoading(false); setCatalogError(''); setCatalogFallback(false);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        const initialPaasConfig = paasConfigRef.current;
        setFormData({ title: initialData?.title || '', subtitle: initialData?.subtitle || '', url: initialData?.url || initialPaasConfig.jumpBaseUrl || '', category: initialData?.category || '智能体任务', statusText: initialData?.statusText || '长期开放', description: initialData?.description || '', color: initialData?.color || 'violet', plugFlag: initialData?.paasV2PlugFlag || initialData?.plugFlag || '', answerType: initialData?.paasV2AnswerType || initialData?.answerType || DEFAULT_ANSWER_TYPE, softwareUnique: initialData?.paasV2SoftwareUnique || initialData?.softwareUnique || 'scyxcjrh', cover: initialData?.paasV2Cover || initialData?.cover || '' });
        resetCatalog(); setMenuSoftwareUnique(null); setShowManual(false); setEditingBuiltin(false); setEditingSoftwareUnique(null);
        setManualPlatform({ code: '', name: '', softwareUnique: '', theme: DEFAULT_AGENT_PLATFORM_THEME });
        if (!initialData?.id) setSoftwareUnique(initialSoftwareUnique || initialPaasConfig.productModuleId || 'scyxcjrh');
    }, [initialData, initialSoftwareUnique, isOpen, resetCatalog]);

    useEffect(() => {
        if (!isOpen || initialData?.id || !initialPlatformSoftwareUnique) { initialPlatformRef.current = ''; return; }
        const key = normalizePlatformKey(initialPlatformSoftwareUnique);
        if (initialPlatformRef.current === key) return;
        const platform = allPlatforms.find(item => samePlatform(item.softwareUnique, key));
        if (!platform) return;
        initialPlatformRef.current = key; resetCatalog(); setSoftwareUnique(platform.softwareUnique);
        setEditingSoftwareUnique(platform.softwareUnique); setEditingBuiltin(platform.builtin);
        setManualPlatform({ code: platform.code, name: platform.name, softwareUnique: platform.softwareUnique, theme: normalizeAgentPlatformTheme(platform.theme) });
        setMenuSoftwareUnique(null); setShowManual(true);
    }, [allPlatforms, initialData?.id, initialPlatformSoftwareUnique, isOpen, resetCatalog]);

    const loadCatalog = useCallback(async ({ force = false } = {}) => {
        if (initialData?.id || !catalogPlatform) { resetCatalog(); return; }
        const requestId = ++catalogRequestRef.current;
        catalogAbortRef.current?.abort();
        if (!force) { setCatalogTasks([]); setSelectedKeys(new Set()); }
        setCatalogError(''); setCatalogFallback(false);
        const controller = new AbortController(); catalogAbortRef.current = controller; setCatalogLoading(true);
        try {
            const params = new URLSearchParams({ softwareUnique: catalogPlatform.softwareUnique, platformCode: catalogPlatform.code, platformName: catalogPlatform.name });
            if (force) params.set('force', '1');
            const data = await api.get(`/paas-v2/catalog?${params}`, { fallback: '智能体任务目录读取失败', timeoutMs: 120_000, retry: 0, signal: controller.signal });
            if (catalogRequestRef.current !== requestId) return;
            setCatalogTasks(Array.isArray(data.tasks) ? data.tasks : []); setSelectedKeys(new Set());
            setCatalogFallback(data.source === 'database-fallback');
            setCatalogError(data.refreshError ? `刷新失败，已使用已保存目录：${data.refreshError}` : '');
        } catch (error) {
            if (catalogRequestRef.current !== requestId || error.name === 'AbortError') return;
            if (!force) { setCatalogTasks([]); setSelectedKeys(new Set()); }
            setCatalogFallback(false); setCatalogError(error.message || '智能体任务目录读取失败');
        } finally {
            if (catalogRequestRef.current === requestId) { setCatalogLoading(false); if (catalogAbortRef.current === controller) catalogAbortRef.current = null; }
        }
    }, [initialData?.id, catalogPlatform, resetCatalog]);
    useEffect(() => { if (isOpen && !initialData?.id) loadCatalog(); return () => catalogAbortRef.current?.abort(); }, [isOpen, initialData?.id, loadCatalog]);

    const importedCounts = useMemo(() => {
        const counts = new Map();
        for (const key of storedKeys) { const platformKey = key.split('\u0000')[0]; counts.set(platformKey, (counts.get(platformKey) || 0) + 1); }
        return counts;
    }, [storedKeys]);
    const platformStatus = item => {
        const total = samePlatform(item.softwareUnique, softwareUnique) && catalogTasks.length ? catalogTasks.length : item.catalogTaskCount;
        const imported = importedCounts.get(normalizePlatformKey(item.softwareUnique)) || 0;
        return total > 0 ? (imported === 0 ? 'red' : imported >= total ? 'green' : 'yellow') : item.catalogSyncStatus === 'not_found' ? 'red' : imported > 0 || item.taskCount > 0 ? 'green' : 'red';
    };
    const availableTasks = catalogTasks.filter(task => !storedKeys.has(taskKey(softwareUnique, task.plugFlag)));
    const selectedCount = availableTasks.filter(task => selectedKeys.has(task.plugFlag)).length;
    const allSelected = availableTasks.length > 0 && availableTasks.every(task => selectedKeys.has(task.plugFlag));
    const toggleTask = plugFlag => setSelectedKeys(current => { const next = new Set(current); if (next.has(plugFlag)) next.delete(plugFlag); else next.add(plugFlag); return next; });
    const toggleAll = () => setSelectedKeys(allSelected ? new Set() : new Set(availableTasks.map(task => task.plugFlag)));
    const selectPlatform = value => { if (!samePlatform(value, softwareUnique)) resetCatalog(); setSoftwareUnique(value); setMenuSoftwareUnique(null); };
    const editPlatform = item => { setEditingSoftwareUnique(item.softwareUnique); setEditingBuiltin(item.builtin); setManualPlatform({ code: item.code, name: item.name, softwareUnique: item.softwareUnique, theme: normalizeAgentPlatformTheme(item.theme) }); setMenuSoftwareUnique(null); setShowManual(true); };
    const openManual = () => { setEditingSoftwareUnique(null); setEditingBuiltin(false); setManualPlatform({ code: '', name: '', softwareUnique: '', theme: DEFAULT_AGENT_PLATFORM_THEME }); setShowManual(true); };
    const savePlatform = async () => {
        if (busy || operationRef.current) return;
        const data = { code: manualPlatform.code.trim(), name: manualPlatform.name.trim(), softwareUnique: manualPlatform.softwareUnique.trim(), theme: normalizeAgentPlatformTheme(manualPlatform.theme) };
        if (!data.code || !data.name || !data.softwareUnique) { notify('请填写软件代码、软件名称和 softwareUnique', 'warning'); return; }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(data.softwareUnique)) { notify('softwareUnique 仅支持字母、数字、点、下划线和中划线', 'warning'); return; }
        operationRef.current = true;
        setPlatformSaving(true);
        try {
            const result = editingSoftwareUnique ? await api.put(`/paas-v2/platforms/${encodeURIComponent(editingSoftwareUnique)}`, data, { fallback: '软件平台更新失败', retry: 0 }) : await api.post('/paas-v2/platforms', data, { fallback: '软件平台创建失败', retry: 0 });
            await onPlatformsChange(); resetCatalog(); setSoftwareUnique(result?.softwareUnique || data.softwareUnique);
            setEditingSoftwareUnique(null); setEditingBuiltin(false); setShowManual(false); setMenuSoftwareUnique(null);
            notify(editingSoftwareUnique ? '软件平台已更新并同步到云端' : '软件平台已保存到云端', 'success');
        } catch (error) { notify(error.message || '软件平台保存失败', 'error'); } finally { operationRef.current = false; setPlatformSaving(false); }
    };
    const deletePlatform = async item => {
        if (busy || operationRef.current) return;
        operationRef.current = true;
        setPlatformSaving(true);
        const count = Number(item.taskCount) || 0;
        try {
            if (!await confirmAction({ title: '删除智能体模块', message: count > 0 ? `确定删除「${item.code} · ${item.name}」及其 ${count} 个智能体任务吗？任务进度和关联数据也会删除，且无法恢复。` : `确定删除「${item.code} · ${item.name}」这个软件平台吗？删除后无法恢复。`, confirmText: count > 0 ? '删除模块和任务' : '删除平台' })) return;
            await api.delete(`/paas-v2/platforms/${encodeURIComponent(item.softwareUnique)}`, { fallback: '软件平台删除失败', retry: 0 });
            const remaining = await onPlatformsChange();
            if (samePlatform(softwareUnique, item.softwareUnique)) { resetCatalog(); setSoftwareUnique(remaining?.[0]?.softwareUnique || ''); }
            setMenuSoftwareUnique(null); notify('软件平台已从云端删除', 'success');
        } catch (error) { notify(error.message || '软件平台删除失败', 'error'); } finally { operationRef.current = false; setPlatformSaving(false); }
    };
    const saveSingle = async () => {
        if (busy || operationRef.current) return;
        if (!formData.title || !formData.plugFlag || !formData.url || !formData.softwareUnique) { notify('请填写任务名称、跳转地址、任务编码和软件标识', 'warning'); return; }
        const data = { title: formData.title, subtitle: formData.subtitle, url: formData.url, category: formData.category, statusText: formData.statusText, description: formData.description, color: formData.color, ssoMethod: 'paasV2', paasV2PlugFlag: formData.plugFlag, paasV2AnswerType: formData.answerType, paasV2SoftwareUnique: formData.softwareUnique, paasV2Cover: formData.cover };
        operationRef.current = true;
        setSaving(true);
        try { await api.put(`/competitions/${initialData.id}`, data, { fallback: '智能体任务更新失败' }); await onSave?.(); notify('智能体任务已更新', 'success'); onClose(); }
        catch (error) { notify(error.message || '保存失败', 'error'); } finally { operationRef.current = false; setSaving(false); }
    };
    const importSelected = async () => {
        if (busy || operationRef.current) return;
        if (!selectedCount) { notify('请至少选择一个未导入的任务', 'warning'); return; }
        operationRef.current = true;
        setImporting(true);
        try {
            const selected = availableTasks.filter(task => selectedKeys.has(task.plugFlag));
            const covers = [...new Set(selected.map(task => task.cover).filter(Boolean))];
            let coverMap = {}; let partialCovers = false;
            setImportProgress({ total: selected.length, done: 0, phase: covers.length ? 'cover' : 'tasks' });
            for (let offset = 0; offset < covers.length; offset += 100) {
                try {
                    const result = await api.post('/paas-v2/covers/cache', { urls: covers.slice(offset, offset + 100) }, { fallback: '智能体封面缓存失败', timeoutMs: 180_000, retry: 0 });
                    Object.assign(coverMap, result?.covers || {});
                } catch (error) {
                    if (error?.code !== 'cover_url_not_allowed') throw error;
                    partialCovers = true;
                }
            }
            setImportProgress({ total: selected.length, done: 0, phase: 'tasks' });
            const tasks = selected.map(task => ({ title: task.title, subtitle: '', url: task.trainJumpPath || paasConfig.jumpBaseUrl || '', category: catalogPlatform?.name || '智能体任务', statusText: '长期开放', description: task.introduce || '', color: 'violet', ssoMethod: 'paasV2', paasV2PlugFlag: task.plugFlag, paasV2AnswerType: task.answerType || DEFAULT_ANSWER_TYPE, paasV2SoftwareUnique: softwareUnique, paasV2Cover: task.cover ? coverMap[task.cover] || task.cover : '' }));
            const result = await api.post('/competitions/batch-paas-v2', { tasks }, { fallback: '智能体任务导入失败', timeoutMs: 120_000, retry: 0 });
            const reportedCount = Number(result?.created);
            const created = Number.isFinite(reportedCount) ? Math.max(0, Math.min(selected.length, reportedCount)) : selected.length;
            setImportProgress({ total: selected.length, done: created, phase: 'tasks' }); await onSave?.();
            notify(`已导入 ${created} 个智能体任务${partialCovers ? '（部分封面未缓存）' : ''}`, partialCovers ? 'warning' : 'success'); onClose();
        } catch (error) { notify(error.message || '导入失败', 'error'); } finally { operationRef.current = false; setImporting(false); setImportProgress(null); }
    };

    if (!isOpen) return null;
    const update = (key, value) => setFormData(current => ({ ...current, [key]: value }));
    return <>
        <div className="mc-modal-backdrop mc-modal-backdrop--elevated" onMouseDown={event => { if (event.target === event.currentTarget) closeMain(); }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-app-modal-title" aria-describedby="task-app-modal-description" tabIndex={-1} className="mc-modal mc-modal--medium max-h-[92vh]">
                <div className="mc-modal__header !px-6 !py-4"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-violet-600"><Bot className="h-5 w-5" /></span><div><h2 id="task-app-modal-title" className="text-lg font-black text-slate-900 dark:text-white">{initialData?.id ? '编辑智能体任务' : '新增智能体任务'}</h2><p id="task-app-modal-description" className="text-[10px] text-slate-400">{initialData?.id ? '修改单个 task_app 卡片' : '选择云端软件平台并导入 task_app 任务'}</p></div></div><button type="button" onClick={closeMain} disabled={busy} aria-label="关闭智能体任务窗口" className="mc-icon-button mc-modal__close"><X className="h-5 w-5" /></button></div>
                <div className="mc-modal__body custom-scrollbar !p-6">
                    {initialData?.id ? <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {[['title', '任务名称'], ['subtitle', '副标题'], ['cover', '封面图片 Cover URL'], ['url', '跳转地址 trainJumpPath'], ['plugFlag', '任务编码 plugFlag']].map(([key, label]) => <label key={key} className="space-y-2"><span className="text-[10px] font-bold text-slate-500">{label}</span><input value={formData[key] || ''} onChange={event => update(key, event.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>)}
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">答题类型 answerType</span><select value={formData.answerType} onChange={event => update('answerType', event.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`}><option value="1,2,3,4">1,2,3,4（全部）</option>{['1', '2', '3', '4'].map(value => <option key={value}>{value}</option>)}</select></label>
                        <label className="space-y-2"><span className="text-[10px] font-bold text-slate-500">软件标识 softwareUnique</span><select value={formData.softwareUnique} onChange={event => update('softwareUnique', event.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`}>{allPlatforms.map(item => <option key={item.softwareUnique} value={item.softwareUnique}>{item.code} · {item.name}</option>)}{!allPlatforms.some(item => samePlatform(item.softwareUnique, formData.softwareUnique)) && <option value={formData.softwareUnique}>{formData.softwareUnique} · 当前平台</option>}</select></label>
                        {[['category', '分类'], ['statusText', '状态文字']].map(([key, label]) => <label key={key} className="space-y-2"><span className="text-[10px] font-bold text-slate-500">{label}</span><input value={formData[key] || ''} onChange={event => update(key, event.target.value)} className={`${GLASS_INPUT} h-10 w-full px-3`} /></label>)}
                    </div> : <div className="mt-5"><div className="space-y-3"><div className="flex gap-2 overflow-x-auto pb-3 pt-1">{allPlatforms.map(item => <PlatformCard key={item.softwareUnique} item={item} active={samePlatform(softwareUnique, item.softwareUnique)} menuOpen={samePlatform(menuSoftwareUnique, item.softwareUnique)} disabled={busy} status={platformStatus(item)} onSelect={selected => selectPlatform(selected.softwareUnique)} onToggleMenu={selected => setMenuSoftwareUnique(current => samePlatform(current, selected.softwareUnique) ? null : selected.softwareUnique)} onEdit={editPlatform} onDelete={deletePlatform} />)}<button type="button" onClick={openManual} disabled={busy} aria-label="手动添加软件平台" className="grid min-h-[76px] w-[104px] shrink-0 place-items-center rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 text-violet-500"><span className="grid place-items-center gap-1"><Plus className="h-5 w-5" /><span className="text-[9px] font-bold">添加软件</span></span></button></div>
                        <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><Cloud className="h-3.5 w-3.5 text-emerald-500" />任务目录已保存到云端数据库 · 共 {catalogTasks.length} 个任务，已导入 {catalogTasks.length - availableTasks.length} 个，选中 {selectedCount} 个</span><button type="button" onClick={() => loadCatalog({ force: true })} disabled={catalogLoading || busy} className="flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${catalogLoading ? 'animate-spin' : ''}`} />刷新目录</button></div></div>
                        {catalogError && <p className={`mt-3 rounded-xl px-3 py-2 text-xs font-bold ${catalogFallback ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'}`}>{catalogError}</p>}
                        <div className="mt-4 max-h-[420px] overflow-y-auto rounded-2xl border border-slate-100"><div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-2"><button type="button" onClick={toggleAll} disabled={busy || catalogLoading || !availableTasks.length} className="flex items-center gap-2 text-[10px] font-bold text-violet-600 disabled:opacity-40">{allSelected ? <Eraser className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}{allSelected ? '清空选择' : '全选未导入'}</button><span className="text-[10px] text-slate-400">{catalogPlatform?.code || softwareUnique || '智能体'} 智能体 task_app 目录</span></div>
                            {catalogLoading ? <div className="flex h-48 items-center justify-center gap-2 text-xs font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin text-violet-500" />正在读取任务目录…</div> : !catalogTasks.length ? <div className="flex h-48 flex-col items-center justify-center text-slate-400"><Inbox className="h-8 w-8" /><span className="mt-2 text-xs font-bold">没有可导入的任务</span></div> : <div className="grid gap-2 sm:grid-cols-2">{catalogTasks.map(task => { const already = storedKeys.has(taskKey(softwareUnique, task.plugFlag)); const checked = selectedKeys.has(task.plugFlag); return <button key={task.plugFlag} type="button" disabled={already || busy} aria-pressed={checked} onClick={() => toggleTask(task.plugFlag)} className={`group flex min-h-[76px] items-start gap-3 rounded-2xl border p-3 text-left transition ${already ? 'cursor-default border-emerald-100 bg-emerald-50/60 opacity-70' : checked ? 'border-violet-300 bg-violet-50 shadow-sm' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300 bg-white'}`}>{checked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5 text-slate-400" />}</span><span className="min-w-0 flex-1"><b className="block truncate text-xs text-slate-800">{task.title}</b><small className="mt-1 block font-mono text-[9px] text-slate-400">plugFlag {task.plugFlag}</small><small className="mt-0.5 block text-[9px] text-slate-400">answerType {task.answerType}</small></span>{already && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[8px] font-black text-emerald-700">已导入</span>}</button>; })}</div>}
                        </div></div>}
                    {importing && importProgress && <div className="mt-4" role="status" aria-live="polite"><div className="mb-1.5 flex justify-between text-[10px] font-bold text-slate-500"><span>{importProgress.phase === 'cover' ? '正在缓存任务封面…' : `正在导入任务 ${importProgress.done}/${importProgress.total}`}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full bg-gradient-to-r from-indigo-500 to-violet-500 ${importProgress.phase === 'cover' ? 'w-full animate-pulse' : ''}`} style={importProgress.phase === 'cover' ? undefined : { width: `${Math.round(importProgress.done / Math.max(importProgress.total, 1) * 100)}%` }} /></div></div>}
                </div>
                <div className="mc-modal__footer !px-6 !py-4"><button type="button" onClick={closeMain} disabled={busy} className="mc-button mc-button--secondary mc-button--compact">取消</button><button type="button" onClick={initialData?.id ? saveSingle : importSelected} disabled={busy || (!initialData?.id && !selectedCount)} className="mc-button mc-button--primary mc-button--compact">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{initialData?.id ? saving ? '保存中…' : '保存' : importing ? '导入中…' : '导入所选任务'}</button></div>
            </div>
        </div>
        {showManual && <div className="mc-modal-backdrop mc-modal-backdrop--critical" onMouseDown={event => { if (event.target === event.currentTarget) closeManual(); }}><div ref={manualDialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-platform-title" aria-describedby="manual-platform-description" tabIndex={-1} className="mc-modal mc-modal--compact !p-6">
            <div className="flex items-center justify-between gap-4"><div><h3 id="manual-platform-title" className="text-base font-black text-slate-900 dark:text-white">{editingBuiltin ? '编辑内置平台' : editingSoftwareUnique ? '编辑软件平台' : '手动添加软件'}</h3><p id="manual-platform-description" className="text-[10px] text-slate-400">{editingBuiltin ? '修改后会同步到所有用户，softwareUnique 保持不变' : editingSoftwareUnique ? '修改后会同步更新已有任务的平台归属' : '平台会保存到 D1 云端数据库，可跨设备使用'}</p></div><button type="button" onClick={closeManual} disabled={platformSaving} aria-label="关闭软件平台窗口" className="mc-icon-button mc-modal__close"><X className="h-5 w-5" /></button></div>
            <div className="mt-5 space-y-3">{[['code', '软件代码', '例如 PT0405'], ['name', '软件名称', '例如 物流人机协同产教融合平台'], ['softwareUnique', 'softwareUnique', '输入 softwareUnique']].map(([key, label, placeholder]) => <label key={key} className="block space-y-1"><span className="text-[10px] font-bold text-slate-500">{label}</span><input value={manualPlatform[key]} onChange={event => setManualPlatform(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} disabled={platformSaving || (editingBuiltin && key === 'softwareUnique')} className={`${GLASS_INPUT} h-10 w-full px-3 disabled:opacity-60`} /></label>)}
                <fieldset className="space-y-2"><legend className="text-[10px] font-bold text-slate-500">模块主题色</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="模块主题色">{AGENT_PLATFORM_THEMES.map(theme => { const checked = normalizeAgentPlatformTheme(manualPlatform.theme) === theme.value; return <button key={theme.value} type="button" role="radio" aria-checked={checked} onClick={() => setManualPlatform(current => ({ ...current, theme: theme.value }))} disabled={platformSaving} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-[10px] font-bold ${checked ? 'border-violet-400 bg-violet-50 text-slate-800 shadow-sm' : 'border-slate-200 bg-white text-slate-500'}`}><i className="h-5 w-5 shrink-0 rounded-full" style={{ background: theme.gradient }} /><span className="min-w-0 flex-1 truncate">{theme.label}</span>{checked && <span>✓</span>}</button>; })}</div><p className="text-[9px] leading-4 text-slate-400">主题色会同步应用到模块外框、智能体图标、卡片渐变条和进入任务按钮。</p></fieldset>
            </div>
            <div className="mc-modal__footer !-mx-6 !-mb-6 !mt-6 !px-6 !py-4"><button type="button" onClick={closeManual} disabled={platformSaving} className="mc-button mc-button--secondary mc-button--compact">取消</button><button type="button" onClick={savePlatform} disabled={platformSaving} className="mc-button mc-button--primary mc-button--compact">{platformSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}{platformSaving ? '正在同步…' : editingSoftwareUnique ? '保存修改' : '保存并获取任务'}</button></div>
        </div></div>}
    </>;
};

export default TaskAppModal;
