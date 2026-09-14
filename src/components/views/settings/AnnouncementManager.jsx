import React, { useState } from 'react';
import { Clock, ExternalLink, Edit2, Trash2, RotateCcw } from 'lucide-react';
import { GLASS_INPUT, PRIMARY_BTN } from '../../../constants/config';
import { confirmAction, notify } from '../../../utils/uiFeedback';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';

const toDatetimeLocal = value => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const AnnouncementManager = ({ announcements, onUpdate, loadError = '', onRetry }) => {
    const [form, setForm] = useState({ title: '', content: '', link: '', duration: '10', closeAt: '', targetType: 'all' });
    const [editingId, setEditingId] = useState(null);

    // 提交处理
    const handleSubmit = async () => {
        if (!form.title || !form.content) return notify('请填写完整内容', 'warning');

        let scheduledCloseAt = null;
        if (form.closeAt) {
            const date = new Date(form.closeAt);
            if (Number.isNaN(date.getTime())) return notify('自动关闭时间格式无效', 'warning');
            scheduledCloseAt = date.toISOString();
        }
        let newList;
        if (editingId) {
            // 编辑模式
            newList = announcements.map(ann =>
                ann.id === editingId ? {
                    ...ann,
                    ...form,
                    duration: parseInt(form.duration) || 0,
                    closeAt: scheduledCloseAt,
                    createdAt: new Date().toISOString()
                } : ann
            );
        } else {
            // 新增模式
            const newAnn = {
                id: Date.now(),
                ...form,
                duration: parseInt(form.duration) || 0,
                closeAt: scheduledCloseAt,
                createdAt: new Date().toISOString()
            };
            newList = [newAnn, ...announcements];
        }

        // 调用父组件更新数据
        const saved = await onUpdate(newList);
        if (!saved) return;
        notify(editingId ? '公告修改成功' : '公告发布成功', 'success');
        resetForm();
    };

    // 填充编辑
    const handleEdit = (ann) => {
        setEditingId(ann.id);
        setForm({
            title: ann.title,
            content: ann.content,
            link: ann.link || '',
            duration: ann.duration?.toString() || '10',
            closeAt: toDatetimeLocal(ann.closeAt),
            targetType: ann.targetType || 'all'
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // 删除
    const handleDelete = async (id) => {
        if (await confirmAction({
            title: '删除公告',
            message: '确定删除该公告吗？',
            confirmText: '删除'
        })) {
            const newList = announcements.filter(a => a.id !== id);
            const saved = await onUpdate(newList);
            if (!saved) return;
            if (editingId === id) resetForm();
        }
    };

    // 重置
    const resetForm = () => {
        setEditingId(null);
        setForm({ title: '', content: '', link: '', duration: '10', closeAt: '', targetType: 'all' });
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">公告管理</h1>
            <LoadErrorNotice message={loadError} onRetry={onRetry} />

            {/* 编辑表单 */}
            <div className="bg-indigo-50 dark:bg-slate-800/50 border border-indigo-100 dark:border-slate-700 rounded-2xl p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <input
                        placeholder="标题"
                        className={`w-full px-4 py-3 rounded-xl text-sm font-bold ${GLASS_INPUT} dark:bg-slate-800 dark:text-white dark:border-slate-700`}
                        value={form.title}
                        onChange={e => setForm({ ...form, title: e.target.value })}
                    />
                    <input
                        placeholder="跳转链接 (可选)"
                        className={`w-full px-4 py-3 rounded-xl text-sm ${GLASS_INPUT} dark:bg-slate-800 dark:text-white dark:border-slate-700`}
                        value={form.link}
                        onChange={e => setForm({ ...form, link: e.target.value })}
                    />
                </div>
                <div className="flex items-center gap-2 bg-white/50 dark:bg-slate-800/50 px-4 py-2 rounded-xl border border-indigo-100 dark:border-slate-700">
                    <Clock className="w-4 h-4 text-indigo-400 dark:text-indigo-300" />
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-300 whitespace-nowrap">显示时长(秒):</span>
                    <input
                        type="number"
                        className="w-20 bg-transparent text-sm font-bold outline-none text-indigo-600 dark:text-indigo-400"
                        value={form.duration}
                        onChange={e => setForm({ ...form, duration: e.target.value })}
                    />
                    <span className="text-xs text-slate-400 ml-auto">0 = 永久显示</span>
                    <select
                        value={form.targetType}
                        onChange={e => setForm({ ...form, targetType: e.target.value })}
                        className="rounded-lg border border-indigo-100 bg-white px-2 py-1.5 text-xs font-bold text-slate-600 outline-none"
                        title="公告接收范围"
                    >
                        <option value="all">全部账号</option>
                        <option value="admin">管理员</option>
                        <option value="teacher">教师</option>
                        <option value="student">学生</option>
                    </select>
                </div>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-white/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <Clock className="h-4 w-4 text-indigo-400 dark:text-indigo-300" />
                    <label className="flex flex-1 flex-wrap items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-300">
                        <span>自动关闭时间:</span>
                        <input
                            type="datetime-local"
                            value={form.closeAt}
                            onChange={e => setForm({ ...form, closeAt: e.target.value })}
                            className="min-w-[210px] flex-1 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-bold text-indigo-600 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-indigo-300"
                        />
                    </label>
                    <span className="text-[11px] text-slate-400">留空表示不按日期关闭；到时所有用户自动隐藏</span>
                </div>
                <textarea
                    placeholder="公告内容"
                    className={`w-full px-4 py-3 rounded-xl text-sm resize-none ${GLASS_INPUT} dark:bg-slate-800 dark:text-white dark:border-slate-700`}
                    value={form.content}
                    onChange={e => setForm({ ...form, content: e.target.value })}
                />
                <div className="flex gap-3">
                    <button onClick={handleSubmit} className={`flex-1 px-6 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center ${PRIMARY_BTN}`}>
                        {editingId ? '更新公告' : '发布公告'}
                    </button>
                    {editingId && (
                        <button onClick={resetForm} className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors">
                            <RotateCcw className="w-4 h-4 mr-2" /> 取消
                        </button>
                    )}
                </div>
            </div>

            {/* 公告列表 */}
            <div className="space-y-3">
                {announcements.map(a => (
                    <div key={a.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl flex justify-between border dark:border-slate-700 items-start shadow-sm transition-colors group">
                        <div>
                            <div className="font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                                {a.title}
                                {a.duration > 0 && <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-1.5 py-0.5 rounded">{a.duration}s</span>}
                                {a.closeAt && <span className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">{new Date(a.closeAt).toLocaleString()} 自动关闭</span>}
                                {a.link && <a href={a.link} target="_blank" rel="noreferrer" className="text-indigo-500 hover:text-indigo-400"><ExternalLink className="w-3 h-3" /></a>}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{a.content}</div>
                        </div>
                        <div className="flex gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleEdit(a)} className="text-indigo-500 hover:bg-indigo-50 dark:hover:bg-slate-700 p-2 rounded-lg transition-colors" title="编辑"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => handleDelete(a.id)} className="text-red-400 hover:bg-red-50 dark:hover:bg-slate-700 p-2 rounded-lg transition-colors" title="删除"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    </div>
                ))}
                {announcements.length === 0 && (
                    <div className="text-center text-slate-400 text-xs py-8">暂无发布公告</div>
                )}
            </div>
        </div>
    );
};

export default AnnouncementManager;
