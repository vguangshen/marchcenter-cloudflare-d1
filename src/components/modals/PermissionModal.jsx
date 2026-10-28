import React, { useState, useEffect } from 'react';
import { CalendarClock, CheckCheck, Eraser, ShieldCheck, X, Search } from 'lucide-react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import { notify } from '../../utils/uiFeedback';
import { applySelectedTimeRules, clearSelectedTimeRules, getPermissionCounts } from '../../utils/permissionTime';
import ModulePermissionSelector, { BatchPermissionTimeEditor } from './ModulePermissionSelector';

const PermissionModal = ({ isOpen, onClose, user, allLinks = [], agentPlatforms = [], currentPermissions, currentUserTimeRules, onSave }) => {
    const [selectedIds, setSelectedIds] = useState([]);
    const [timeRules, setTimeRules] = useState({});
    const [expandedTimeId, setExpandedTimeId] = useState(null);
    const [showBatchTimeEditor, setShowBatchTimeEditor] = useState(false);
    const [batchTime, setBatchTime] = useState({ unlockTime: '', lockTime: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const dialogRef = useModalAccessibility(isOpen, onClose);

    useEffect(() => {
        if (isOpen && user) {
            setSelectedIds(currentPermissions || []);
            setTimeRules(currentUserTimeRules || {});
            setSearchTerm('');
            setShowBatchTimeEditor(false);
            setBatchTime({ unlockTime: '', lockTime: '' });
        }
    }, [isOpen, user, currentPermissions, currentUserTimeRules]);

    const toggleId = id => setSelectedIds(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    const toggleAll = () => setSelectedIds(previous => allLinks.length > 0 && allLinks.every(link => previous.includes(link.id)) ? [] : allLinks.map(link => link.id));
    const updateTimeRule = (linkId, type, value) => setTimeRules(previous => ({ ...previous, [linkId]: { ...previous[linkId], [type]: value } }));
    const updateBatchTime = (field, value) => setBatchTime(previous => ({ ...previous, [field]: value }));
    const applyBatchTime = () => {
        if (!selectedIds.length || (!batchTime.unlockTime && !batchTime.lockTime)) return;
        setTimeRules(previous => applySelectedTimeRules(previous, selectedIds, batchTime));
        setShowBatchTimeEditor(false);
        notify(`已为 ${selectedIds.length} 个模块统一设置时间`, 'success');
    };
    const clearBatchTime = () => {
        if (!selectedIds.length) return;
        setTimeRules(previous => clearSelectedTimeRules(previous, selectedIds));
        setBatchTime({ unlockTime: '', lockTime: '' });
        setShowBatchTimeEditor(false);
        notify(`已清空 ${selectedIds.length} 个模块的专属时间`, 'success');
    };

    if (!isOpen) return null;

    const counts = getPermissionCounts(allLinks, selectedIds);
    const selectedCount = counts.selectedPlatform + counts.selectedAgent;
    const allSelected = allLinks.length > 0 && allLinks.every(link => selectedIds.includes(link.id));

    return (
        <div className="mc-modal-backdrop mc-modal-backdrop--overlay animate-in fade-in duration-300">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="permission-modal-title" tabIndex={-1} className="mc-modal mc-modal--medium">
                <div className="mc-modal__header mc-modal__header--dark">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md border border-white/10"><ShieldCheck className="w-6 h-6 text-emerald-400" /></div>
                        <div>
                            <h3 id="permission-modal-title" className="text-lg font-bold tracking-tight">模块权限与时间控制</h3>
                            <p className="text-xs text-slate-400 font-medium">正在编辑: <span className="text-white font-bold">{user?.username}</span></p>
                        </div>
                        <div className="relative ml-2">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                            <input type="text" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="搜索模块 / 类目名称" className="w-64 rounded-lg border border-white/15 bg-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-white/40" />
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭权限设置窗口" className="mc-icon-button mc-modal__close !text-white/60 hover:!bg-white/10 hover:!text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span>已选</span><span className="text-indigo-600">{counts.selectedPlatform} 个平台</span><span className="text-slate-300">·</span><span className="text-violet-600">{counts.selectedAgent} 个智能体</span>
                            <span className="ml-1 text-[10px] font-medium text-slate-400">共 {counts.totalPlatform} 个平台 · {counts.totalAgent} 个智能体</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={toggleAll} disabled={!allLinks.length} className={`mc-button mc-button--ghost mc-button--compact !px-2 !text-[10px] disabled:cursor-not-allowed disabled:opacity-40 ${allSelected ? '!text-red-600 hover:!bg-red-50' : '!text-indigo-600 hover:!bg-indigo-50'}`} aria-label={allSelected ? '清空已选模块' : '全选模块'}>
                                {allSelected ? <Eraser className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />}{allSelected ? '清空' : '全选'}
                            </button>
                            <button type="button" onClick={() => setShowBatchTimeEditor(previous => !previous)} disabled={selectedCount === 0} aria-expanded={showBatchTimeEditor} aria-controls="permission-batch-time-editor" className="mc-button mc-button--secondary mc-button--compact !border-violet-200 !px-2.5 !text-[10px] !text-violet-600 hover:!bg-violet-50"><CalendarClock className="h-3.5 w-3.5" />{showBatchTimeEditor ? '收起时间' : '统一设置时间'}</button>
                        </div>
                    </div>
                    {showBatchTimeEditor && <div id="permission-batch-time-editor"><BatchPermissionTimeEditor selectedCount={selectedCount} selectedPlatformCount={counts.selectedPlatform} selectedAgentCount={counts.selectedAgent} unlockTime={batchTime.unlockTime} lockTime={batchTime.lockTime} onChange={updateBatchTime} onApply={applyBatchTime} onClear={clearBatchTime} /></div>}
                </div>
                <div className="mc-modal__body custom-scrollbar">
                    <ModulePermissionSelector allLinks={allLinks} selectedIds={selectedIds} timeRules={timeRules} expandedTimeId={expandedTimeId} searchTerm={searchTerm} agentPlatforms={agentPlatforms} onToggleId={toggleId} onUpdateTimeRule={updateTimeRule} onToggleTime={setExpandedTimeId} />
                </div>
                <div className="mc-modal__footer">
                    <button type="button" onClick={onClose} className="mc-button mc-button--secondary">取消</button>
                    <button type="button" onClick={() => onSave(user.id, selectedIds, timeRules)} className="mc-button mc-button--primary">保存设置</button>
                </div>
            </div>
        </div>
    );
};

export default PermissionModal;
