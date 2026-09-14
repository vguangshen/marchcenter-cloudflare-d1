import React from 'react';
import { Megaphone, ExternalLink, X } from 'lucide-react';

const AnnouncementBanner = ({ announcement, isVisible, isClosing, onClose, themeSettings }) => {

    // 如果没有公告或者不可见且不在关闭动画中，直接返回 null
    if (!announcement || (!isVisible && !isClosing)) return null;

    const { immersive } = themeSettings;
    const openAnnouncement = () => {
        if (announcement.link) window.open(announcement.link, '_blank', 'noopener,noreferrer');
    };

    const announcementContent = (
        <>
            <div className={`p-2.5 rounded-xl shrink-0 ${immersive ? 'bg-white/50 dark:bg-slate-700/50' : 'bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-indigo-400'}`}>
                <Megaphone className="w-5 h-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
                <h4 className="mb-0.5 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <span className="truncate">{announcement.title}</span>
                    {announcement.link && <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />}
                </h4>
                <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{announcement.content}</p>
            </div>
        </>
    );

    return (
        <div
            className={`
                glass-motion-container mb-8 w-full max-w-4xl mx-auto
                transition-all duration-700 ease-[cubic-bezier(0.68,-0.55,0.265,1.55)] origin-top-right
                ${isClosing ? 'opacity-0 scale-[0.01] translate-x-[45vw] -translate-y-[100px] blur-md' : 'opacity-100 scale-100 translate-x-0 translate-y-0'}
            `}
        >
            <div
                className={`
                    glass-motion-surface group relative overflow-hidden rounded-2xl border backdrop-blur-md shadow-sm transition-all hover:scale-[1.01]
                    ${immersive === 'christmas' ? 'bg-red-50/90 border-red-200 dark:bg-red-900/80 dark:border-red-800' : ''}
                    ${immersive === 'lunar_new_year' ? 'bg-orange-50/90 border-orange-200 dark:bg-red-900/80 dark:border-orange-800' : ''}
                    ${immersive === 'qingming' ? 'bg-slate-100/90 border-slate-300 dark:bg-slate-800/90 dark:border-slate-600' : ''}
                    ${!immersive || immersive === 'none' ? 'bg-white/80 border-indigo-100 dark:bg-slate-800/90 dark:border-slate-600' : 'bg-white/90 border-white/50 dark:bg-slate-800/90 dark:border-slate-600'}
                `}
                role="group"
                aria-label="系统公告"
            >
                {announcement.link ? (
                    <button
                        type="button"
                        onClick={openAnnouncement}
                        aria-label={`打开公告链接：${announcement.title}`}
                        className="flex w-full cursor-pointer items-start gap-4 p-4 pr-12 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                    >
                        {announcementContent}
                    </button>
                ) : (
                    <div className="flex items-start gap-4 p-4 pr-12">{announcementContent}</div>
                )}
                {/* 关闭按钮 */}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭公告"
                    className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 opacity-60 transition hover:bg-black/5 hover:text-slate-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-white/10"
                >
                    <X className="w-4 h-4" />
                </button>

                {/* 倒计时进度条 */}
                {announcement.duration > 0 && !isClosing && (
                    <div className="absolute bottom-0 left-0 h-0.5 bg-indigo-500/20 dark:bg-indigo-400/20 w-full">
                        <div
                            className="h-full bg-indigo-500 dark:bg-indigo-400"
                            style={{
                                width: '100%',
                                animation: `width-shrink ${announcement.duration}s linear forwards`
                            }}
                        />
                    </div>
                )}
            </div>
            <style>{`@keyframes width-shrink { from { width: 100%; } to { width: 0%; } }`}</style>
        </div>
    );
};

export default AnnouncementBanner;
