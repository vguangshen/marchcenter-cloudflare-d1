import React, { useEffect, useRef, useState } from 'react';
import { Gift, Edit2, Trash2, Eye, EyeOff, Users, Check, X, Loader2 } from 'lucide-react';
import { GLASS_INPUT } from '../../../constants/config';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';

const GiftManager = ({
    giftForm, setGiftForm,
    onSend,
    sentGifts,
    onEdit,
    onDelete,
    users,
    onSearchUsers = async () => [],
    loadError = '',
    onRetry
}) => {
    const [giftSearch, setGiftSearch] = useState('');
    const [giftCandidates, setGiftCandidates] = useState(null);
    const [giftSearching, setGiftSearching] = useState(false);
    const giftSearchTimerRef = useRef(null);

    useEffect(() => {
        const keyword = giftSearch.trim();
        if (!keyword) {
            setGiftCandidates(null);
            return undefined;
        }
        setGiftSearching(true);
        giftSearchTimerRef.current = window.setTimeout(async () => {
            try {
                const results = await onSearchUsers(keyword);
                setGiftCandidates(Array.isArray(results) ? results : []);
            } catch {
                setGiftCandidates([]);
            } finally {
                setGiftSearching(false);
            }
        }, 300);
        return () => window.clearTimeout(giftSearchTimerRef.current);
    }, [giftSearch, onSearchUsers]);

    useEffect(() => () => window.clearTimeout(giftSearchTimerRef.current), []);

    // 过滤出普通用户（不给管理员发礼物）
    const targetableUsers = (giftCandidates !== null ? giftCandidates : users)
        .filter(u => u.role !== 'super_admin');

    // 切换单个用户选中状态
    const toggleUser = (userId) => {
        const currentTargets = giftForm.targetUsers || [];
        if (currentTargets.includes(userId)) {
            setGiftForm({ ...giftForm, targetUsers: currentTargets.filter(id => id !== userId) });
        } else {
            setGiftForm({ ...giftForm, targetUsers: [...currentTargets, userId] });
        }
    };

    // 全选
    const selectAll = () => {
        setGiftForm({ ...giftForm, targetUsers: targetableUsers.map(u => u.id) });
    };

    // 清空
    const clearAll = () => {
        setGiftForm({ ...giftForm, targetUsers: [] });
    };

    return (
        <div className="settings-theme-aware space-y-8 animate-in fade-in duration-500">
            <h1 className="text-2xl font-black text-slate-900">礼物管理</h1>
            <LoadErrorNotice message={loadError} onRetry={onRetry} />

            {/* 发送表单 */}
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 space-y-5 shadow-sm">

                {/* 1. 礼物信息输入 */}
                <div className="space-y-4">
                    <input
                        placeholder="礼物名称 (例如：高阶算法视频教程)"
                        className={`w-full px-4 py-3 rounded-xl text-sm font-bold ${GLASS_INPUT} border-rose-100 focus:border-rose-400 focus:ring-rose-100`}
                        value={giftForm.title}
                        onChange={e => setGiftForm({...giftForm, title: e.target.value})}
                    />
                    <div className="flex gap-2">
                        <select
                            className="px-4 py-3 rounded-xl text-sm bg-white border border-rose-100 outline-none text-slate-600 font-bold min-w-[100px]"
                            value={giftForm.type}
                            onChange={e => setGiftForm({...giftForm, type: e.target.value})}
                        >
                            <option value="link">链接跳转</option>
                            <option value="text">文本口令</option>
                        </select>
                        <input
                            placeholder={giftForm.type === 'link' ? "请输入跳转链接 (https://...)" : "请输入文本内容"}
                            className={`flex-1 px-4 py-3 rounded-xl text-sm ${GLASS_INPUT} border-rose-100 focus:border-rose-400 focus:ring-rose-100`}
                            value={giftForm.content}
                            onChange={e => setGiftForm({...giftForm, content: e.target.value})}
                        />
                    </div>
                </div>

                {/* 用户选择区域 */}
                <div className="bg-white/60 rounded-xl p-4 border border-rose-100">
                    <div className="flex justify-between items-center mb-3">
                        <label className="text-xs font-bold text-rose-500 flex items-center gap-1">
                            <Users className="w-3 h-3"/> 选择接收用户
                        </label>
                        <div className="flex gap-2 text-[10px]">
                            <button onClick={selectAll} className="text-rose-600 hover:bg-rose-100 px-2 py-1 rounded transition-colors font-bold">全选</button>
                            <span className="text-rose-200">|</span>
                            <button onClick={clearAll} className="text-slate-400 hover:bg-slate-100 px-2 py-1 rounded transition-colors">清空</button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                        <input
                            type="text"
                            placeholder="搜索用户名 / 邮箱 / IP..."
                            value={giftSearch}
                            onChange={e => setGiftSearch(e.target.value)}
                            className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold outline-none border border-transparent focus:border-rose-300 transition-all ${GLASS_INPUT}`}
                        />
                        {giftSearching && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-rose-400" />}
                        {giftSearch.trim() && (
                            <button onClick={() => setGiftSearch('')} className="text-[10px] font-bold text-slate-400 hover:text-rose-500" title="清除搜索">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {targetableUsers.length > 0 ? (
                        <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto custom-scrollbar">
                            {targetableUsers.map(u => {
                                const isSelected = giftForm.targetUsers.includes(u.id);
                                return (
                                    <button
                                        key={u.id}
                                        onClick={() => toggleUser(u.id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all duration-200 flex items-center gap-1.5 ${
                                            isSelected
                                            ? 'bg-rose-500 text-white border-rose-600 shadow-md shadow-rose-200 transform scale-105'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-rose-300 hover:text-rose-500'
                                        }`}
                                    >
                                        {isSelected && <Check className="w-3 h-3"/>}
                                        {u.username}
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center text-xs text-slate-400 py-2">
                            {giftSearch.trim() ? '未找到匹配的用户' : '暂无普通用户可发送'}
                        </div>
                    )}
                </div>

                {/* 3. 底部操作栏 */}
                <div className="flex justify-between items-center pt-2 border-t border-rose-100/50">
                    <div className="text-xs text-rose-500 font-medium">
                        已选人数: <span className="font-bold text-lg mx-1">{giftForm.targetUsers.length}</span> 人
                    </div>
                    <button
                        onClick={onSend}
                        disabled={giftForm.targetUsers.length === 0 || !giftForm.title}
                        className={`px-8 py-2.5 rounded-xl text-sm font-bold flex items-center shadow-lg shadow-rose-500/20 transition-all active:scale-95 ${
                            giftForm.targetUsers.length === 0 || !giftForm.title
                            ? 'bg-slate-300 text-white cursor-not-allowed'
                            : 'bg-gradient-to-r from-rose-500 to-orange-500 hover:brightness-110 text-white'
                        }`}
                    >
                        <Gift className="w-4 h-4 mr-2" /> 发送礼物
                    </button>
                </div>
            </div>

            {/* 4. 历史记录列表 */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold text-slate-800">已发送记录 ({sentGifts.length})</h2>
                {sentGifts.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        暂无发送记录
                    </div>
                ) : (
                    <div className="rounded-xl border border-rose-100 overflow-hidden bg-white shadow-sm">
                        <table className="min-w-full text-sm text-left">
                            <thead className="bg-rose-50/50 text-rose-900">
                                <tr>
                                    <th className="px-4 py-3 font-bold text-xs uppercase">礼物名称</th>
                                    <th className="px-4 py-3 font-bold text-xs uppercase">接收人</th>
                                    <th className="px-4 py-3 font-bold text-xs uppercase">内容</th>
                                    <th className="px-4 py-3 font-bold text-xs uppercase">状态</th>
                                    <th className="px-4 py-3 font-bold text-xs uppercase">时间</th>
                                    <th className="px-4 py-3 text-right font-bold text-xs uppercase">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {sentGifts.map(gift => (
                                    <tr key={gift.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 font-bold text-slate-800">{gift.title}</td>
                                        <td className="px-4 py-3 text-slate-600">{gift.recipientName}</td>
                                        <td className="px-4 py-3 text-xs text-slate-500 max-w-[150px] truncate" title={gift.content}>{gift.content}</td>
                                        <td className="px-4 py-3">
                                            {gift.read ? (
                                                <span className="inline-flex items-center text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><Eye className="w-3 h-3 mr-1"/> 已领取</span>
                                            ) : (
                                                <span className="inline-flex items-center text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full"><EyeOff className="w-3 h-3 mr-1"/> 未读</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-400 font-mono">{new Date(gift.sentAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 text-right flex justify-end gap-2">
                                            <button onClick={() => onEdit(gift)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                                            <button onClick={() => onDelete(gift.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GiftManager;
