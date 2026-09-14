import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { GLASS_INPUT, PRIMARY_BTN } from '../../constants/config';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

const EditGiftModal = ({ isOpen, onClose, gift, onSave }) => {
    const [formData, setFormData] = useState({ title: '', content: '', type: 'link' });
    const dialogRef = useModalAccessibility(isOpen, onClose);

    useEffect(() => {
        if (isOpen && gift) {
            setFormData({
                title: gift.title,
                content: gift.content,
                type: gift.type
            });
        }
    }, [isOpen, gift]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in zoom-in-95">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-gift-title" tabIndex={-1} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden outline-none">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                    <h3 id="edit-gift-title" className="font-bold text-slate-800">编辑礼物</h3>
                    <button onClick={onClose} aria-label="关闭编辑礼物窗口" className="p-1 hover:bg-slate-100 rounded-full"><X className="w-5 h-5 text-slate-400"/></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">礼物名称</label>
                        <input className={`w-full px-3 py-2 rounded-lg text-sm ${GLASS_INPUT}`} value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">类型</label>
                        <select className="theme-form-control w-full px-3 py-2 rounded-lg text-sm bg-slate-50 border-slate-200 outline-none" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                            <option value="link">链接</option>
                            <option value="text">文本</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">内容</label>
                        <textarea rows="3" className={`w-full px-3 py-2 rounded-lg text-sm resize-none ${GLASS_INPUT}`} value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} />
                    </div>
                </div>
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-200">取消</button>
                    <button onClick={() => onSave(gift.id, formData)} className={`px-4 py-2 rounded-lg text-xs font-bold ${PRIMARY_BTN}`}>保存修改</button>
                </div>
            </div>
        </div>
    );
};

export default EditGiftModal;
