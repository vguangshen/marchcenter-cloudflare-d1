import React, { useEffect, useState } from 'react';
import { Gift, Clock, Link as LinkIcon } from 'lucide-react';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';

const GiftModal = ({ isOpen, onClose, gift, onOpenLink }) => {
    const [showDetails, setShowDetails] = useState(false);
    const dialogRef = useModalAccessibility(isOpen && Boolean(gift), onClose);
    useEffect(() => setShowDetails(false), [gift?.id, isOpen]);
    if (!isOpen || !gift) return null;

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 animate-in zoom-in-95 duration-300">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gift-modal-title" tabIndex={-1} className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border-4 border-white relative outline-none">
                {/* 装饰彩带效果 */}
                <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-rose-500 to-rose-600"></div>
                <div className="absolute top-[-50px] left-1/2 -translate-x-1/2 w-24 h-24 bg-white/20 rotate-45 rounded-xl backdrop-blur-sm"></div>

                <div className="relative pt-12 pb-8 px-6 flex flex-col items-center text-center">
                    <div className="w-20 h-20 bg-white rounded-full shadow-lg flex items-center justify-center mb-4 relative z-10 ring-4 ring-rose-100">
                        <Gift className="w-10 h-10 text-rose-500 animate-bounce" />
                    </div>

                    <h3 id="gift-modal-title" className="text-2xl font-black text-slate-800 mb-2">收到一份礼物！</h3>
                    <p className="text-sm text-slate-500 mb-6 px-4">管理员为您发送了一份专属学习资料，请查收。</p>

                    <div className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 mb-6">
                        <div className="font-bold text-slate-800 mb-1">{gift.title}</div>
                        <div className="text-xs text-slate-400 flex items-center justify-center gap-1">
                            <Clock className="w-3 h-3" /> {new Date(gift.sentAt).toLocaleDateString()}
                        </div>
                        {showDetails && (
                            <div className="mt-3 border-t border-slate-200 pt-3 text-left text-sm leading-6 text-slate-600 whitespace-pre-wrap">
                                {gift.content}
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 w-full">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors text-sm"
                        >
                            稍后查看
                        </button>
                        {gift.type === 'link' ? (
                            <a
                                href={gift.content}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => { onOpenLink(gift.id); }}
                                className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg shadow-rose-500/30 flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-rose-500 to-orange-500 hover:brightness-110 transition-all`}
                            >
                                <LinkIcon className="w-4 h-4" /> 立即打开
                            </a>
                        ) : (
                            <button
                                onClick={() => {
                                    setShowDetails(true);
                                    onOpenLink(gift.id);
                                }}
                                className={`flex-1 py-3 rounded-xl font-bold text-white shadow-lg shadow-rose-500/30 flex items-center justify-center gap-2 text-sm bg-gradient-to-r from-rose-500 to-orange-500 hover:brightness-110 transition-all`}
                            >
                                查看详情
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GiftModal;
