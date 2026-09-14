import React from 'react';
import {
    LogOut, Plus, Search, LayoutDashboard, Settings,
    Edit3, Check, Megaphone, LayoutGrid, Bot
} from 'lucide-react';
import { GLASS_INPUT } from '../../constants/config';
import { THEMES } from '../../constants/themes';
import BrandLogo from '../branding/BrandLogo';

const CHRISTMAS_ORNAMENTS = [{ icon: '🎀', left: '10%', speed: '3.5s', length: 12 }, { icon: '🔔', left: '25%', speed: '4s', length: 16 }, { icon: '🎁', left: '40%', speed: '3s', length: 10 }, { icon: '🧦', left: '55%', speed: '4.5s', length: 18 }, { icon: '🍪', left: '70%', speed: '3.2s', length: 14 }, { icon: '🦌', left: '85%', speed: '3.8s', length: 12 }];
const LUNAR_ORNAMENTS = [{ icon: '🏮', left: '8%', speed: '4s', length: 20, size: 'text-3xl' }, { icon: '🧧', left: '22%', speed: '3s', length: 10, size: 'text-xl' }, { icon: '🏮', left: '35%', speed: '4.5s', length: 15, size: 'text-2xl' }, { icon: '✨', left: '50%', speed: '3s', length: 8, size: 'text-lg' }, { icon: '🏮', left: '65%', speed: '4s', length: 18, size: 'text-2xl' }, { icon: '🧧', left: '80%', speed: '3.5s', length: 12, size: 'text-xl' }, { icon: '🏮', left: '92%', speed: '5s', length: 22, size: 'text-3xl' }];
const HALLOWEEN_ORNAMENTS = [{ icon: '🕷️', left: '10%', speed: '5s', length: 40, size: 'text-2xl' }, { icon: '🕸️', left: '25%', speed: '0s', length: 10, size: 'text-3xl' }, { icon: '👻', left: '40%', speed: '3s', length: 20, size: 'text-xl' }, { icon: '💀', left: '55%', speed: '4s', length: 15, size: 'text-xl' }, { icon: '🎃', left: '70%', speed: '3s', length: 25, size: 'text-2xl' }, { icon: '🦇', left: '85%', speed: '2s', length: 12, size: 'text-xl' }];
const MID_AUTUMN_ORNAMENTS = [{ icon: '🌕', left: '10%', speed: '4s', length: 15, size: 'text-2xl' }, { icon: '🐇', left: '25%', speed: '3s', length: 12, size: 'text-xl' }, { icon: '🥮', left: '40%', speed: '5s', length: 18, size: 'text-2xl' }, { icon: '🏮', left: '55%', speed: '4s', length: 14, size: 'text-xl' }, { icon: '🍵', left: '70%', speed: '3.5s', length: 10, size: 'text-xl' }, { icon: '✨', left: '85%', speed: '2.5s', length: 20, size: 'text-lg' }];
const DRAGON_BOAT_ORNAMENTS = [{ icon: '🫔', left: '10%', speed: '4s', length: 20, size: 'text-2xl' }, { icon: '🥁', left: '25%', speed: '3s', length: 15, size: 'text-2xl' }, { icon: '🎐', left: '40%', speed: '5s', length: 25, size: 'text-2xl' }, { icon: '🌿', left: '55%', speed: '4s', length: 18, size: 'text-xl' }, { icon: '🫔', left: '70%', speed: '3.5s', length: 22, size: 'text-2xl' }, { icon: '🛶', left: '85%', speed: '2.5s', length: 12, size: 'text-2xl' }];
const YUANXIAO_ORNAMENTS = [{ icon: '🍡', left: '10%', speed: '3s', length: 15, size: 'text-2xl' }, { icon: '🏮', left: '25%', speed: '4s', length: 20, size: 'text-3xl' }, { icon: '🐇', left: '40%', speed: '3.5s', length: 12, size: 'text-2xl' }, { icon: '🥣', left: '55%', speed: '5s', length: 18, size: 'text-2xl' }, { icon: '🧧', left: '70%', speed: '4s', length: 14, size: 'text-xl' }, { icon: '✨', left: '85%', speed: '2s', length: 25, size: 'text-lg' }];
const QINGMING_ORNAMENTS = [{ icon: '🪁', left: '10%', speed: '3s', length: 25, size: 'text-2xl' }, { icon: '🌿', left: '25%', speed: '4s', length: 18, size: 'text-xl' }, { icon: '🐦', left: '40%', speed: '2.5s', length: 12, size: 'text-xl' }, { icon: '🌧️', left: '55%', speed: '5s', length: 20, size: 'text-2xl' }, { icon: '⛰️', left: '70%', speed: '0s', length: 15, size: 'text-xl' }, { icon: '🍃', left: '85%', speed: '3.5s', length: 10, size: 'text-lg' }];

const Navbar = ({
    isAdmin, canManageUsers, user, onLogout, activePage, setActivePage,
    siteConfig, searchTerm, setSearchTerm, onAdd, onAddTaskApp, immersiveMode,
    isCardEditMode, setIsCardEditMode,
    showCategoryArrange, categoryArrangeEnabled, onToggleCategoryArrange,
    // Announcement state controls the compact inbox entry.
    hasActiveAnnouncement, isAnnouncementVisible, onToggleAnnouncement,
    enteringFromLogin = false,
    onEntryTransitionEnd,
    activeThemeColor = 'blue'
}) => {
    const isChristmas = immersiveMode === 'christmas';
    const isLunar = immersiveMode === 'lunar_new_year';
    const isHalloween = immersiveMode === 'halloween';
    const isMidAutumn = immersiveMode === 'mid_autumn';
    const isDragonBoat = immersiveMode === 'dragon_boat';
    const isYuanxiao = immersiveMode === 'yuanxiao';
    const isQingming = immersiveMode === 'qingming';
    const suspendAmbientMotion = activePage === 'settings';
    const navbarTheme = THEMES[activeThemeColor] || THEMES.blue;

    const renderNavbarLogo = () => {
        const logoType = siteConfig?.navbarLogoType || siteConfig?.loginLogoType || 'Trophy';
        const logoUrl = siteConfig?.navbarLogoUrl || siteConfig?.customLogoUrl;
        return (
            <BrandLogo
                type={logoType}
                url={logoUrl}
                className="h-7 w-7 text-white"
                imageClassName="h-7 w-7 object-contain"
            />
        );
    };

    const getSafeTitle = () => {
        const brandName = siteConfig?.loginBrandName;
        if (typeof brandName === 'string' && brandName.trim()) return brandName;
        const titleData = siteConfig?.loginTitle;
        if (!titleData) return "Competition Hub";
        return typeof titleData === 'object' ? (titleData.text || "Competition Hub") : titleData;
    };

    const getCurrentOrnaments = () => {
        if (isChristmas) return CHRISTMAS_ORNAMENTS;
        if (isLunar) return LUNAR_ORNAMENTS;
        if (isHalloween) return HALLOWEEN_ORNAMENTS;
        if (isMidAutumn) return MID_AUTUMN_ORNAMENTS;
        if (isDragonBoat) return DRAGON_BOAT_ORNAMENTS;
        if (isYuanxiao) return YUANXIAO_ORNAMENTS;
        if (isQingming) return QINGMING_ORNAMENTS;
        return [];
    };

    return (
        <nav className={`dashboard-navbar fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8 py-4 pointer-events-none ${
            enteringFromLogin ? 'dashboard-navbar-entering' : ''
        }`}>

            {/* Immersive top decoration */}
            {(isChristmas || isLunar || isHalloween || isMidAutumn || isDragonBoat || isYuanxiao || isQingming) && (
                <div className="absolute top-0 left-0 right-0 h-24 pointer-events-none z-50 overflow-hidden">
                    <div className={`absolute top-0 left-0 right-0 h-3 shadow-md border-b
                        ${isChristmas ? 'bg-gradient-to-b from-green-900 to-green-800 border-green-950/30' : ''}
                        ${isLunar ? 'bg-gradient-to-b from-red-800 to-red-600 border-red-900/30' : ''}
                        ${isHalloween ? 'bg-gradient-to-b from-gray-900 to-gray-800 border-purple-900/50' : ''}
                        ${isMidAutumn ? 'bg-gradient-to-b from-blue-950 to-blue-900 border-blue-800/50' : ''}
                        ${isDragonBoat ? 'bg-gradient-to-r from-teal-600 via-emerald-500 to-teal-600 border-teal-700/30' : ''}
                        ${isYuanxiao ? 'bg-gradient-to-r from-pink-500 to-rose-500 border-pink-700/30' : ''}
                        ${isQingming ? 'bg-gradient-to-r from-slate-400 to-teal-700 border-slate-500/30' : ''}
                    `}></div>
                    <div className="absolute top-2 left-0 right-0 flex justify-between px-8">
                        {Array.from({ length: 30 }).map((_, i) => (
                            <div key={i} className={`w-1 h-1 rounded-full ${suspendAmbientMotion ? '' : 'animate-pulse'} ${isChristmas && i % 2 === 0 ? 'bg-red-500 shadow-[0_0_5px_red]' : ''} ${isChristmas && i % 2 !== 0 ? 'bg-yellow-400 shadow-[0_0_5px_yellow]' : ''} ${isLunar ? 'bg-yellow-400 shadow-[0_0_5px_gold] w-1.5 h-1.5' : ''} ${isHalloween ? 'bg-purple-500 shadow-[0_0_5px_purple]' : ''} ${isMidAutumn ? 'bg-yellow-200 shadow-[0_0_5px_white]' : ''} ${isDragonBoat ? ['bg-red-500', 'bg-yellow-400', 'bg-blue-500', 'bg-white', 'bg-black'][i % 5] + ' shadow-sm w-1.5 h-1.5' : ''} ${isYuanxiao ? 'bg-white shadow-[0_0_5px_white]' : ''} ${isQingming ? 'bg-slate-300 shadow-[0_0_2px_black]' : ''}`} style={{ animationDelay: `${i * 0.1}s` }} />
                        ))}
                    </div>
                    {getCurrentOrnaments().map((item, i) => (
                        <div key={i} className={`absolute top-0 flex flex-col items-center ${suspendAmbientMotion ? '' : 'animate-swing-natural'}`} style={{ left: item.left, animationDuration: item.speed === '0s' ? '0s' : item.speed, height: `${item.length + 30}px` }}>
                            <div className={`w-[1px] ${isLunar ? 'bg-red-300/60' : ''} ${isHalloween ? 'bg-gray-500/30' : ''} ${isChristmas ? 'bg-slate-300/60' : ''} ${isMidAutumn ? 'bg-blue-300/40' : ''} ${isDragonBoat ? 'bg-emerald-300/50' : ''} ${isYuanxiao ? 'bg-pink-300/50' : ''} ${isQingming ? 'bg-slate-400/40' : ''}`} style={{ height: `${item.length}px` }}></div>
                            <div className={`${item.size || 'text-2xl'} filter drop-shadow-md cursor-pointer pointer-events-auto hover:scale-110 transition-transform relative -top-1`}>{item.icon}</div>
                        </div>
                    ))}
                </div>
            )}

            <div className="max-w-7xl mx-auto relative">
                <div className={`dashboard-navbar-surface
                    relative group/nav
                    backdrop-blur-xl
                    rounded-2xl shadow-sm px-4 py-3
                    flex items-center justify-between
                    pointer-events-auto

                    ${isChristmas ? 'bg-white/70 dark:bg-[#1e293b]/70 border border-white/50 dark:border-slate-700 mt-2 border-t-red-100/50 shadow-red-500/5' : ''}
                    ${isLunar ? 'bg-gradient-to-r from-red-50/90 to-orange-50/90 border-2 border-red-200/50 shadow-lg shadow-red-600/10 mt-3' : ''}
                    ${isHalloween ? 'bg-slate-900/90 border-2 border-purple-500/30 shadow-lg shadow-purple-900/20 mt-3' : ''}
                    ${isMidAutumn ? 'bg-slate-900/80 border border-blue-500/30 shadow-lg shadow-blue-500/10 mt-3 text-blue-50' : ''}
                    ${isDragonBoat ? 'bg-teal-50/90 border-2 border-emerald-200/60 shadow-lg shadow-teal-600/10 mt-3' : ''}
                    ${isYuanxiao ? 'bg-pink-50/90 border-2 border-rose-200/60 shadow-lg shadow-pink-500/10 mt-3' : ''}
                    ${isQingming ? 'bg-slate-50/80 border border-slate-300/50 shadow-lg shadow-slate-500/10 mt-3 grayscale-[0.2]' : ''}

                    ${!isChristmas && !isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-white/70 dark:bg-[#1e293b]/70 border border-white/50 dark:border-slate-700' : ''}
                `}>

                    {/* 装饰图标 */}
                    {isChristmas && <><div className="absolute -top-1.5 -left-1 text-xl z-20 opacity-90">❄️</div><div className="absolute -top-1.5 -right-1 text-xl z-20 opacity-90">❄️</div></>}
                    {isLunar && <><div className="absolute -top-2 -left-2 text-2xl z-20 filter drop-shadow-sm rotate-[-15deg]">🧧</div><div className="absolute -bottom-1 -right-1 text-xl z-20 filter drop-shadow-sm">✨</div></>}
                    {isHalloween && <><div className="absolute -top-3 -left-2 text-2xl z-20 filter drop-shadow-sm rotate-12">🕸️</div><div className="absolute -bottom-2 -right-1 text-xl z-20 opacity-80">🕯️</div></>}
                    {isMidAutumn && <><div className="absolute -top-2 -left-2 text-2xl z-20 filter drop-shadow-sm">🌕</div><div className="absolute -bottom-1 -right-1 text-xl z-20 filter drop-shadow-sm opacity-80">🐇</div></>}
                    {isDragonBoat && <><div className="absolute -top-2 -left-2 text-2xl z-20 filter drop-shadow-sm rotate-[-10deg]">🌿</div><div className="absolute -bottom-1 -right-1 text-xl z-20 filter drop-shadow-sm rotate-12">🥁</div></>}
                    {isYuanxiao && <><div className="absolute -top-2 -left-2 text-2xl z-20 filter drop-shadow-sm">🍡</div><div className="absolute -bottom-1 -right-1 text-xl z-20 filter drop-shadow-sm">🏮</div></>}
                    {isQingming && <><div className="absolute -top-2 -left-2 text-2xl z-20 filter drop-shadow-sm rotate-[-10deg] opacity-80">🪁</div><div className="absolute -bottom-1 -right-1 text-xl z-20 filter drop-shadow-sm opacity-80">🌧️</div></>}

                    {/* Logo */}
                    <button type="button" className="dashboard-navbar-brand flex min-w-0 items-center gap-3 cursor-pointer group z-10" onClick={() => setActivePage('dashboard')} aria-label="返回竞赛首页">
                        <div className={`navbar-brand-mark relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr ${navbarTheme.gradient} ${navbarTheme.shadow} shadow-lg transition-transform duration-300 group-hover:scale-105`}>
                            {renderNavbarLogo()}
                            {isChristmas && <span className="absolute -top-3 -right-2 text-xl filter drop-shadow-sm rotate-12">🎅</span>}
                        </div>
                        <span className={`hidden truncate bg-clip-text text-lg font-black tracking-tight text-transparent sm:block
                            ${isLunar ? 'bg-gradient-to-r from-red-800 to-orange-700' : ''}
                            ${isHalloween ? 'bg-gradient-to-r from-orange-400 to-purple-400' : ''}
                            ${isMidAutumn ? 'bg-gradient-to-r from-yellow-100 to-blue-200' : ''}
                            ${isDragonBoat ? 'bg-gradient-to-r from-teal-800 to-emerald-600' : ''}
                            ${isYuanxiao ? 'bg-gradient-to-r from-pink-600 to-purple-600' : ''}
                            ${isQingming ? 'bg-gradient-to-r from-slate-700 to-gray-500' : ''}
                            ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300' : ''}
                        `}>
                            {getSafeTitle()}
                        </span>
                    </button>

                    {/* Search Bar */}
                    {activePage === 'dashboard' && (
                        <div className="dashboard-navbar-search hidden md:flex flex-1 max-w-md mx-8 relative group z-10">
                            <Search className={`absolute left-3 top-2.5 w-4 h-4 transition-colors
                                ${isLunar ? 'text-red-400 group-focus-within:text-red-600' : ''}
                                ${isHalloween ? 'text-purple-400 group-focus-within:text-orange-500' : ''}
                                ${isMidAutumn ? 'text-blue-300 group-focus-within:text-yellow-200' : ''}
                                ${isDragonBoat ? 'text-teal-500 group-focus-within:text-teal-700' : ''}
                                ${isYuanxiao ? 'text-pink-400 group-focus-within:text-pink-600' : ''}
                                ${isQingming ? 'text-slate-400 group-focus-within:text-slate-600' : ''}
                                ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'text-slate-400 group-focus-within:text-indigo-500' : ''}
                            `} />
                            <input
                                type="text"
                                className={`w-full pl-10 pr-4 py-2 rounded-xl text-sm transition-all border border-transparent focus:w-full ${GLASS_INPUT}
                                    ${isLunar ? 'focus:border-red-300 focus:bg-red-50/50 placeholder-red-300 text-red-800' : ''}
                                    ${isHalloween ? 'bg-slate-800/50 text-white placeholder-slate-500 focus:border-orange-500 focus:bg-slate-800' : ''}
                                    ${isMidAutumn ? 'bg-blue-950/50 text-blue-100 placeholder-blue-400/50 focus:border-yellow-200/50 focus:bg-blue-900/80' : ''}
                                    ${isDragonBoat ? 'focus:border-teal-300 focus:bg-teal-50/50 placeholder-teal-400 text-teal-900' : ''}
                                    ${isYuanxiao ? 'focus:border-pink-300 focus:bg-pink-50/50 placeholder-pink-300 text-pink-900' : ''}
                                    ${isQingming ? 'focus:border-slate-300 focus:bg-slate-100/50 placeholder-slate-400 text-slate-700' : ''}
                                    ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'focus:border-indigo-200 focus:bg-white' : ''}
                                `}
                                placeholder="搜索竞赛或类目..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Right Actions */}
                    <div
                        className="dashboard-navbar-actions flex items-center gap-3 z-10"
                        onAnimationEnd={(event) => {
                            if (
                                enteringFromLogin
                                && event.target === event.currentTarget
                                && event.animationName === 'dashboard-navbar-control-in'
                            ) onEntryTransitionEnd?.();
                        }}
                    >
                        {showCategoryArrange && activePage === 'dashboard' && (
                            <button
                                type="button"
                                onClick={onToggleCategoryArrange}
                                aria-pressed={categoryArrangeEnabled}
                                title={categoryArrangeEnabled ? '取消分类排列' : '按分类排列'}
                                className={`h-9 px-3 rounded-xl text-xs font-bold flex items-center transition-all shadow-sm ${
                                    categoryArrangeEnabled
                                        ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800'
                                        : 'bg-white/80 text-slate-600 border border-slate-200 hover:bg-white dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700'
                                }`}
                            >
                                <LayoutGrid className="w-3.5 h-3.5 xl:mr-1.5" />
                                <span className="hidden xl:inline">分类排列</span>
                            </button>
                        )}

                        {/* Animated announcement inbox */}
                        {hasActiveAnnouncement && !isAnnouncementVisible && activePage === 'dashboard' && (
                            <>
                                <style>{`
                                    @keyframes elastic-pop {
                                        0% { transform: scale(0); }
                                        40% { transform: scale(1.3); }
                                        70% { transform: scale(0.9); }
                                        100% { transform: scale(1); }
                                    }
                                `}</style>
                                <button
                                    onClick={onToggleAnnouncement}
                                    style={{ animation: 'elastic-pop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' }}
                                    className={`w-9 h-9 rounded-xl flex items-center justify-center relative
                                        ${isLunar ? 'bg-red-100 text-red-600 hover:bg-red-200' : ''}
                                        ${isHalloween ? 'bg-slate-800 text-orange-400 border border-purple-800' : ''}
                                        ${isMidAutumn ? 'bg-blue-900/50 text-yellow-200 border border-blue-500' : ''}
                                        ${isQingming ? 'bg-slate-200 text-slate-600 hover:bg-slate-300' : ''}
                                        ${!isLunar && !isHalloween && !isMidAutumn && !isQingming ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 shadow-sm border border-indigo-100' : ''}
                                    `}
                                     title="有新公告"
                                     aria-label="查看新公告"
                                >
                                    <Megaphone className="w-4 h-4 animate-[wiggle_1s_ease-in-out_infinite]" />
                                    <span className="absolute top-2 right-2 flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                    </span>
                                </button>
                            </>
                        )}

                        {canManageUsers && activePage === 'dashboard' && (
                            <>
                                <button onClick={() => setActivePage('settings')} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all ${isLunar ? 'bg-red-100 text-red-700 hover:bg-red-200' : ''} ${isHalloween ? 'bg-purple-900/50 text-orange-400 hover:bg-purple-900 border border-purple-500/30' : ''} ${isMidAutumn ? 'bg-blue-800/50 text-yellow-100 hover:bg-blue-800 border border-blue-500/30' : ''} ${isDragonBoat ? 'bg-teal-100 text-teal-700 hover:bg-teal-200 border border-teal-200' : ''} ${isYuanxiao ? 'bg-pink-100 text-pink-700 hover:bg-pink-200 border border-pink-200' : ''} ${isQingming ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 border border-slate-300' : ''} ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : ''}`}>
                                    <Settings className="w-3.5 h-3.5 mr-1.5"/> 系统工具
                                </button>
                                {isAdmin && <button onClick={() => setIsCardEditMode(!isCardEditMode)} className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all shadow-sm ${isCardEditMode ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : isLunar ? 'bg-white border border-red-200 text-red-700 hover:bg-red-50' : isHalloween ? 'bg-slate-800 border border-orange-500/30 text-purple-300 hover:bg-slate-700' : isMidAutumn ? 'bg-blue-900/50 border border-blue-400/30 text-blue-200 hover:bg-blue-800' : isDragonBoat ? 'bg-white border border-teal-200 text-teal-700 hover:bg-teal-50' : isYuanxiao ? 'bg-white border border-pink-200 text-pink-700 hover:bg-pink-50' : isQingming ? 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-100' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                    {isCardEditMode ? <Check className="w-3.5 h-3.5 mr-1.5"/> : <Edit3 className="w-3.5 h-3.5 mr-1.5"/>}
                                    {isCardEditMode ? '完成' : '编辑'}
                                </button>}
                                {isAdmin && isCardEditMode && (
                                    <>
                                        <button onClick={onAdd} className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white flex items-center hover:bg-slate-800 transition-colors shadow-lg animate-in fade-in slide-in-from-right-4">
                                            <Plus className="w-3.5 h-3.5 mr-1.5" /> 新增竞赛平台
                                        </button>
                                        <button onClick={onAddTaskApp} className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white flex items-center hover:bg-violet-500 transition-colors shadow-lg animate-in fade-in slide-in-from-right-4">
                                            <Bot className="w-3.5 h-3.5 mr-1.5" /> 新增智能体任务
                                        </button>
                                    </>
                                )}
                            </>
                        )}

                        {canManageUsers && activePage === 'settings' && (
                            <button onClick={() => setActivePage('dashboard')} className="px-4 py-2 rounded-xl text-xs font-bold flex items-center transition-all bg-slate-800 text-white shadow-lg hover:bg-slate-700">
                                <LayoutDashboard className="w-3.5 h-3.5 mr-1.5"/> 退出设置
                            </button>
                        )}

                        <div className={`h-6 w-px mx-1 ${isLunar ? 'bg-red-200' : ''} ${isHalloween ? 'bg-purple-800' : ''} ${isMidAutumn ? 'bg-blue-800' : ''} ${isDragonBoat ? 'bg-teal-200' : ''} ${isYuanxiao ? 'bg-pink-200' : ''} ${isQingming ? 'bg-slate-300' : ''} ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-slate-200 dark:bg-slate-700' : ''}`}></div>

                        <button onClick={onLogout} className={`text-xs font-bold transition-colors flex items-center
                            ${isLunar ? 'text-red-500 hover:text-red-700' : ''}
                            ${isHalloween ? 'text-purple-400 hover:text-orange-400' : ''}
                            ${isMidAutumn ? 'text-blue-300 hover:text-yellow-100' : ''}
                            ${isDragonBoat ? 'text-teal-600 hover:text-teal-800' : ''}
                            ${isYuanxiao ? 'text-pink-500 hover:text-pink-700' : ''}
                            ${isQingming ? 'text-slate-600 hover:text-slate-800' : ''}
                            ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'text-slate-500 hover:text-slate-800' : ''}
                        `}>
                            退出 <LogOut className="w-3.5 h-3.5 ml-1"/>
                        </button>

                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black border-2 border-white shadow-sm relative overflow-hidden
                            ${isLunar ? 'bg-red-100 text-red-600' : ''}
                            ${isHalloween ? 'bg-orange-100 text-purple-700' : ''}
                            ${isMidAutumn ? 'bg-blue-900 text-yellow-200 border-blue-400' : ''}
                            ${isDragonBoat ? 'bg-teal-100 text-teal-600 border-teal-200' : ''}
                            ${isYuanxiao ? 'bg-pink-100 text-pink-600 border-pink-200' : ''}
                            ${isQingming ? 'bg-slate-200 text-slate-600 border-slate-300' : ''}
                            ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-indigo-100 text-indigo-600' : ''}
                        `}>
                            {user?.username?.[0]?.toUpperCase()}
                        </div>
                    </div>
                </div>
                {activePage === 'dashboard' && (
                    <div className="relative mt-3 md:hidden">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            aria-label="搜索竞赛或类目"
                            className={`w-full rounded-xl border border-transparent py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-indigo-200 ${GLASS_INPUT}`}
                            placeholder="搜索竞赛或类目..."
                            value={searchTerm}
                            onChange={event => setSearchTerm(event.target.value)}
                        />
                    </div>
                )}
            </div>
        </nav>
    );
};

export default Navbar;
