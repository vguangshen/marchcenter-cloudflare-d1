import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Trash2, X } from 'lucide-react';
import { GLASS_INPUT } from '../../constants/config';
import { confirmAction, notify } from '../../utils/uiFeedback';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

const ROLE_RANK = { super_admin: 3, admin: 2, teacher: 1, student: 0, user: 0 };
const ROLE_LABELS = { admin: '管理员', teacher: '教师', student: '学生', user: '学生' };

const DeleteUserModal = ({ isOpen, onClose, onDelete, users, currentUser }) => {
    const [selectedIds, setSelectedIds] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [loading, setLoading] = useState(false);
    const dialogRef = useModalAccessibility(isOpen, onClose);

    const safeUsers = useMemo(() => (Array.isArray(users) ? users : []).filter(user =>
        Number(user.id) !== Number(currentUser?.id) &&
        (ROLE_RANK[currentUser?.role] ?? -1) > (ROLE_RANK[user.role] ?? 0)
    ), [users, currentUser]);
    const filteredUsers = useMemo(() => {
        const query = filterText.trim().toLowerCase();
        if (!query) return safeUsers;
        return safeUsers.filter(user => `${user.username || ''} ${user.email || ''}`.toLowerCase().includes(query));
    }, [safeUsers, filterText]);
    const filteredIds = useMemo(() => filteredUsers.map(user => user.id), [filteredUsers]);
    const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.includes(id));

    useEffect(() => {
        if (!isOpen) return;
        setSelectedIds([]);
        setFilterText('');
        setLoading(false);
    }, [isOpen]);

    const handleToggle = (id) => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    const handleSelectAll = () => setSelectedIds(current => {
        if (allFilteredSelected) return current.filter(id => !filteredIds.includes(id));
        return [...new Set([...current, ...filteredIds])];
    });

    const handleSubmit = async () => {
        const targets = safeUsers.filter(user => selectedIds.includes(user.id));
        if (!targets.length) return notify('请先勾选要删除的账号', 'warning');
        if (!await confirmAction({
            title: '批量删除账号',
            message: `即将永久删除 ${targets.length} 个账号及其关联数据，此操作无法恢复。`,
            confirmText: '确认删除'
        })) return;

        setLoading(true);
        try {
            await onDelete(targets.map(user => user.id));
            onClose();
        } catch (error) {
            notify(error.message || '删除失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in zoom-in-95">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="delete-user-title" tabIndex={-1} className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border-2 border-red-100 bg-white shadow-2xl outline-none">
                <div className="flex items-center justify-between border-b border-red-50 bg-red-50/30 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-red-100 p-2 text-red-600"><Trash2 className="h-5 w-5" /></div>
                        <div>
                            <h3 id="delete-user-title" className="text-lg font-bold text-slate-800">删除账号</h3>
                            <p className="text-xs text-slate-400">搜索并勾选需要删除的账号。</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭删除账号窗口" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
                    <div className="mb-4 flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input className={`w-full rounded-xl py-2.5 pl-9 pr-4 text-sm ${GLASS_INPUT}`} placeholder="搜索用户名或邮箱" value={filterText} onChange={event => setFilterText(event.target.value)} autoFocus />
                        </div>
                        <button type="button" onClick={handleSelectAll} disabled={!filteredUsers.length} className="whitespace-nowrap rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
                            {allFilteredSelected ? '取消当前' : '全选当前'}
                        </button>
                    </div>

                    <div className="custom-scrollbar h-72 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                        {filteredUsers.length ? (
                            <div className="divide-y divide-slate-100">
                                {filteredUsers.map(user => {
                                    const selected = selectedIds.includes(user.id);
                                    return (
                                        <label key={user.id} className={`flex cursor-pointer items-center px-4 py-3 transition ${selected ? 'bg-red-50/70' : 'hover:bg-white'}`}>
                                            <input type="checkbox" className="mr-3 h-4 w-4 rounded border-slate-300 text-red-600" checked={selected} onChange={() => handleToggle(user.id)} />
                                            <div className="min-w-0 flex-1">
                                                <div className={`truncate text-sm font-bold ${selected ? 'text-red-700' : 'text-slate-700'}`}>{user.username}</div>
                                                <div className="truncate text-xs text-slate-400">{user.email || '未绑定邮箱'}</div>
                                            </div>
                                            <span className="ml-3 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-slate-400">{ROLE_LABELS[user.role] || user.role}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="grid h-full place-items-center px-6 text-center text-sm text-slate-400">{safeUsers.length ? '没有匹配的账号' : '当前没有可删除的账号'}</div>
                        )}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-400">仅显示您有权限管理的账号</span>
                        <span className="font-bold text-red-600">已选中 {selectedIds.length} 人</span>
                    </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
                    <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-200">取消</button>
                    <button type="button" onClick={handleSubmit} disabled={loading || !selectedIds.length} className="flex items-center rounded-xl bg-red-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-500/30 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                        {loading ? '正在删除…' : `删除所选 (${selectedIds.length})`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteUserModal;
