import React, { useState, useEffect } from 'react';
import { ShieldCheck, X, Search } from 'lucide-react';
import { PRIMARY_BTN } from '../../constants/config';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import ModulePermissionSelector from './ModulePermissionSelector';

const PermissionModal = ({ isOpen, onClose, user, allLinks, currentPermissions, currentUserTimeRules, onSave }) => {
    const [selectedIds, setSelectedIds] = useState([]);
    const [timeRules, setTimeRules] = useState({});
    const [expandedTimeId, setExpandedTimeId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const dialogRef = useModalAccessibility(isOpen, onClose);

    useEffect(() => {
        if (isOpen && user) {
            setSelectedIds(currentPermissions || []);
            setTimeRules(currentUserTimeRules || {});
            setSearchTerm('');
        }
    }, [isOpen, user, currentPermissions, currentUserTimeRules]);

    const toggleId = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => setSelectedIds(allLinks.map(l => l.id));
    const handleDeselectAll = () => setSelectedIds([]);

    const updateTimeRule = (linkId, type, value) => {
        setTimeRules(prev => ({
            ...prev,
            [linkId]: { ...prev[linkId], [type]: value }
        }));
    };


    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="permission-modal-title" tabIndex={-1} className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-white/20 outline-none">
                <div className="px-6 py-5 bg-gradient-to-r from-slate-800 to-slate-900 flex justify-between items-center text-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md border border-white/10">
                            <ShieldCheck className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div>
                            <h3 id="permission-modal-title" className="text-lg font-bold tracking-tight">模块权限与时间控制</h3>
                            <p className="text-xs text-slate-400 font-medium">正在编辑: <span className="text-white font-bold">{user?.username}</span></p>
                        </div>
                        <div className="relative ml-2">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={event => setSearchTerm(event.target.value)}
                                placeholder="搜索模块 / 类目名称"
                                className="w-64 rounded-lg border border-white/15 bg-white/10 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-white/40"
                            />
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="关闭权限设置窗口" className="text-white/50 hover:text-white hover:bg-white/10 rounded-full p-2 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs font-bold text-slate-500 flex-shrink-0">
                    <span>已选 {selectedIds.length} / {allLinks.length} 个模块</span>
                    <div className="flex gap-3">
                        <button onClick={handleSelectAll} className="hover:text-indigo-600 underline">全选</button>
                        <button onClick={handleDeselectAll} className="hover:text-red-600 underline">清空</button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar flex-grow bg-white">
                    <ModulePermissionSelector
                        allLinks={allLinks}
                        selectedIds={selectedIds}
                        timeRules={timeRules}
                        expandedTimeId={expandedTimeId}
                        searchTerm={searchTerm}
                        onSearchChange={setSearchTerm}
                        onToggleId={toggleId}
                        onUpdateTimeRule={updateTimeRule}
                        onToggleTime={setExpandedTimeId}
                    />
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0">
                    <button onClick={onClose} className="px-5 py-2.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-sm">取消</button>
                    <button onClick={() => onSave(user.id, selectedIds, timeRules)} className={`px-5 py-2.5 text-sm font-bold rounded-xl ${PRIMARY_BTN}`}>保存设置</button>
                </div>
            </div>
        </div>
    );
};

export default PermissionModal;
