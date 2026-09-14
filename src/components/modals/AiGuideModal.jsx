import React, { useState, useEffect } from 'react';
import { Bot, Sparkle, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

const AiGuideModal = ({ isOpen, onClose, link, aiConfig }) => {
    const [loading, setLoading] = useState(false);
    const [advice, setAdvice] = useState('');
    const [error, setError] = useState('');
    const dialogRef = useModalAccessibility(isOpen, onClose);

    useEffect(() => {
        if (isOpen && link) {
            setLoading(true);
            setAdvice('');
            setError('');
            generateAdvice(link);
        }
    }, [isOpen, link]);

    const generateAdvice = async (targetLink) => {
        try {
            const token = localStorage.getItem('authToken');
            if (!token) throw new Error('请先登录');
            const data = await api.post('/ai/generate', {
                title: targetLink.title,
                category: targetLink.category,
                description: targetLink.description
            });
            setAdvice(data.content || '无建议');

        } catch (err) { setError(err.message); } finally { setLoading(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ai-guide-title" tabIndex={-1} className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900">
                <div className="px-6 py-5 bg-gradient-to-r from-indigo-600 to-purple-600 flex justify-between items-center text-white shrink-0 relative overflow-hidden">
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="p-2.5 bg-white/20 rounded-xl backdrop-blur-md border border-white/10">
                            <Bot className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h3 id="ai-guide-title" className="text-lg font-bold tracking-tight">AI 备赛助手</h3>
                            <p className="text-xs text-indigo-100 opacity-90 font-medium">Powered by {aiConfig?.modelName || 'GLM'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="关闭 AI 备赛助手" className="relative z-10 text-white/80 hover:text-white hover:bg-white/20 rounded-full p-2 transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <div className="custom-scrollbar flex-grow overflow-y-auto bg-slate-50 p-8 dark:bg-slate-950">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 space-y-6">
                            <div className="relative"><div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div><Sparkle className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500 w-6 h-6 animate-pulse" /></div>
                            <p className="animate-pulse text-sm font-medium text-slate-500 dark:text-slate-400">正在分析竞赛数据，生成专属攻略...</p>
                        </div>
                    ) : error ? (
                        <div className="mx-4 rounded-2xl border border-red-100 bg-red-50 py-10 text-center dark:border-red-900/60 dark:bg-red-950/35">
                            <p className="mb-4 font-medium text-red-600 dark:text-red-300">{error}</p>
                            <button onClick={() => generateAdvice(link)} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/50">重试</button>
                        </div>
                    ) : (
                        <div className="prose prose-indigo max-w-none">
                            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/40">
                                <Sparkle className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                                <div><h4 className="m-0 text-sm font-bold text-indigo-900 dark:text-indigo-200">关于 {link?.title}</h4><p className="m-0 mt-1 text-xs text-indigo-700 dark:text-indigo-300">以下建议由 AI 生成，仅供参考，具体赛制请以官网为准。</p></div>
                            </div>
                            <div className="whitespace-pre-wrap rounded-2xl border border-slate-100 bg-white p-6 text-sm font-medium leading-relaxed text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 md:text-base">{advice}</div>
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 justify-end border-t border-slate-100 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
                    <button onClick={onClose} className="rounded-xl bg-slate-100 px-6 py-2.5 font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">知道了</button>
                </div>
            </div>
        </div>
    );
};

export default AiGuideModal;
