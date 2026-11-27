import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
    LogOut, Search, LayoutDashboard, Settings, SlidersHorizontal,
    Pencil, Check, Megaphone, LayoutGrid, Rows3, Bot, LifeBuoy, ChevronDown, ChevronRight, SquarePlus
} from 'lucide-react';
import { DEFAULT_SITE_CONFIG, GLASS_INPUT } from '../../constants/config';
import { THEMES } from '../../constants/themes';
import BrandLogo, { brandLogoHasTile } from '../branding/BrandLogo';
import BrandName from '../branding/BrandName';
import { useBrandIntro } from '../branding/brandIntro';

const CHRISTMAS_ORNAMENTS = [{ icon: '🎀', left: '10%', speed: '3.5s', length: 12 }, { icon: '🔔', left: '25%', speed: '4s', length: 16 }, { icon: '🎁', left: '40%', speed: '3s', length: 10 }, { icon: '🧦', left: '55%', speed: '4.5s', length: 18 }, { icon: '🍪', left: '70%', speed: '3.2s', length: 14 }, { icon: '🦌', left: '85%', speed: '3.8s', length: 12 }];
const LUNAR_ORNAMENTS = [{ icon: '🏮', left: '8%', speed: '4s', length: 20, size: 'text-3xl' }, { icon: '🧧', left: '22%', speed: '3s', length: 10, size: 'text-xl' }, { icon: '🏮', left: '35%', speed: '4.5s', length: 15, size: 'text-2xl' }, { icon: '✨', left: '50%', speed: '3s', length: 8, size: 'text-lg' }, { icon: '🏮', left: '65%', speed: '4s', length: 18, size: 'text-2xl' }, { icon: '🧧', left: '80%', speed: '3.5s', length: 12, size: 'text-xl' }, { icon: '🏮', left: '92%', speed: '5s', length: 22, size: 'text-3xl' }];
const HALLOWEEN_ORNAMENTS = [{ icon: '🕷️', left: '10%', speed: '5s', length: 40, size: 'text-2xl' }, { icon: '🕸️', left: '25%', speed: '0s', length: 10, size: 'text-3xl' }, { icon: '👻', left: '40%', speed: '3s', length: 20, size: 'text-xl' }, { icon: '💀', left: '55%', speed: '4s', length: 15, size: 'text-xl' }, { icon: '🎃', left: '70%', speed: '3s', length: 25, size: 'text-2xl' }, { icon: '🦇', left: '85%', speed: '2s', length: 12, size: 'text-xl' }];
const MID_AUTUMN_ORNAMENTS = [{ icon: '🌕', left: '10%', speed: '4s', length: 15, size: 'text-2xl' }, { icon: '🐇', left: '25%', speed: '3s', length: 12, size: 'text-xl' }, { icon: '🥮', left: '40%', speed: '5s', length: 18, size: 'text-2xl' }, { icon: '🏮', left: '55%', speed: '4s', length: 14, size: 'text-xl' }, { icon: '🍵', left: '70%', speed: '3.5s', length: 10, size: 'text-xl' }, { icon: '✨', left: '85%', speed: '2.5s', length: 20, size: 'text-lg' }];
const DRAGON_BOAT_ORNAMENTS = [{ icon: '🫔', left: '10%', speed: '4s', length: 20, size: 'text-2xl' }, { icon: '🥁', left: '25%', speed: '3s', length: 15, size: 'text-2xl' }, { icon: '🎐', left: '40%', speed: '5s', length: 25, size: 'text-2xl' }, { icon: '🌿', left: '55%', speed: '4s', length: 18, size: 'text-xl' }, { icon: '🫔', left: '70%', speed: '3.5s', length: 22, size: 'text-2xl' }, { icon: '🛶', left: '85%', speed: '2.5s', length: 12, size: 'text-2xl' }];
const YUANXIAO_ORNAMENTS = [{ icon: '🍡', left: '10%', speed: '3s', length: 15, size: 'text-2xl' }, { icon: '🏮', left: '25%', speed: '4s', length: 20, size: 'text-3xl' }, { icon: '🐇', left: '40%', speed: '3.5s', length: 12, size: 'text-2xl' }, { icon: '🥣', left: '55%', speed: '5s', length: 18, size: 'text-2xl' }, { icon: '🧧', left: '70%', speed: '4s', length: 14, size: 'text-xl' }, { icon: '✨', left: '85%', speed: '2s', length: 25, size: 'text-lg' }];
const QINGMING_ORNAMENTS = [{ icon: '🪁', left: '10%', speed: '3s', length: 25, size: 'text-2xl' }, { icon: '🌿', left: '25%', speed: '4s', length: 18, size: 'text-xl' }, { icon: '🐦', left: '40%', speed: '2.5s', length: 12, size: 'text-xl' }, { icon: '🌧️', left: '55%', speed: '5s', length: 20, size: 'text-2xl' }, { icon: '⛰️', left: '70%', speed: '0s', length: 15, size: 'text-xl' }, { icon: '🍃', left: '85%', speed: '3.5s', length: 10, size: 'text-lg' }];

/**
 * The one button used across the navbar. Variants share size, radius and
 * motion: chip (glass), tinted (accent wash), primary (solid accent) and
 * ghost (text). `pressed` makes it a toggle; `iconKey` replays the icon pop
 * when a toggle swaps its icon. Labels collapse to icons on narrow screens
 * unless `keepLabel` is set.
 */
function NavButton({
    icon: Icon, iconKey, iconAfter = false, iconOnly = false, keepLabel = false,
    variant = 'chip', pressed, title, ariaLabel, badge, className = '', iconClassName = '',
    buttonRef, expanded, controls, trailing, onClick, children
}) {
    const icon = Icon && (
        <span key={iconKey} className={`nav-btn__icon ${iconKey ? 'nav-btn__icon--swap' : ''} ${iconClassName}`} aria-hidden="true"><Icon /></span>
    );
    return (
        <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            title={title}
            aria-label={ariaLabel || (iconOnly ? title : undefined)}
            aria-pressed={pressed}
            aria-expanded={expanded}
            aria-controls={controls}
            className={`nav-btn nav-btn--${variant} ${iconOnly ? 'nav-btn--icon-only' : ''} ${keepLabel ? 'nav-btn--keep-label' : ''} ${className}`}
        >
            {!iconAfter && icon}
            {!iconOnly && <span className="nav-btn__label">{children}</span>}
            {iconAfter && icon}
            {trailing}
            {badge}
        </button>
    );
}

function SystemToolsMenu({ onSettings, canEdit, editing, onEdit, onAddContest, onAddAgent }) {
    const menuId = useId();
    const creationId = useId();
    const root = useRef(null);
    const trigger = useRef(null);
    const disclosure = useRef(null);
    const firstCreation = useRef(null);
    const leaveTimer = useRef(null);
    const [open, setOpen] = useState(false);
    const [creationOpen, setCreationOpen] = useState(false);
    const [placement, setPlacement] = useState({ offset: null, inline: true });

    const cancelLeave = () => clearTimeout(leaveTimer.current);
    const close = useCallback(() => {
        clearTimeout(leaveTimer.current);
        setCreationOpen(false);
        setOpen(false);
    }, []);

    const placeMenu = useCallback(() => {
        const anchor = root.current?.getBoundingClientRect();
        if (!anchor) return;
        const viewport = document.documentElement.clientWidth;
        const inline = viewport < 460 || window.matchMedia('(hover: none)').matches;
        const gutter = 12;
        const mainWidth = 168;
        const extraWidth = canEdit && !inline ? 180 + 8 : 0;
        const left = Math.max(gutter, Math.min(anchor.right - mainWidth, viewport - gutter - mainWidth - extraWidth));
        setPlacement({ offset: left - anchor.left, inline });
    }, [canEdit]);

    useEffect(() => () => clearTimeout(leaveTimer.current), []);
    useEffect(() => {
        if (!open) return undefined;
        const outside = event => {
            if (!root.current?.contains(event.target)) close();
        };
        window.addEventListener('pointerdown', outside, true);
        window.addEventListener('resize', placeMenu);
        return () => {
            window.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('resize', placeMenu);
        };
    }, [close, open, placeMenu]);

    function toggleMenu() {
        if (open) return close();
        placeMenu();
        setOpen(true);
    }

    function finish(action, restoreFocus = false) {
        close();
        if (restoreFocus) trigger.current?.focus();
        action();
    }

    function onMenuKey(event) {
        if (!open || (event.key !== 'Escape' && event.key !== 'ArrowLeft')) return;
        if (creationOpen) {
            event.preventDefault();
            event.stopPropagation();
            cancelLeave();
            setCreationOpen(false);
            disclosure.current?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            trigger.current?.focus();
        }
    }

    return (
        <div ref={root} className="nav-tools" data-inline={placement.inline} data-editing={canEdit && editing}
            style={placement.offset === null ? undefined : { '--nav-tools-offset': `${placement.offset}px` }} onKeyDown={onMenuKey}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
            <NavButton buttonRef={trigger} onClick={toggleMenu} icon={Settings} expanded={open} controls={menuId}
                className="nav-btn--accent-icon nav-tools__trigger" ariaLabel="系统工具" title="系统工具"
                trailing={<ChevronDown className="nav-tools__caret" aria-hidden="true" />}>
                系统工具
            </NavButton>
            <div id={menuId} role="group" aria-label="系统工具菜单" className="nav-tools__menu nav-tools__surface" data-open={open} inert={!open}>
                <button type="button" className="nav-tools__row" onClick={() => finish(onSettings)}>
                    <span className="nav-tools__icon" aria-hidden="true"><SlidersHorizontal /></span>
                    系统设置
                </button>
                {canEdit && (
                    <div className="nav-tools__edit"
                        onPointerEnter={event => {
                            if (event.pointerType !== 'mouse' || !open) return;
                            cancelLeave();
                            setCreationOpen(true);
                        }}
                        onPointerLeave={event => {
                            if (event.pointerType !== 'mouse' || event.currentTarget.contains(document.activeElement)) return;
                            leaveTimer.current = setTimeout(() => setCreationOpen(false), 150);
                        }}
                        onKeyDown={event => {
                            if (event.key !== 'ArrowRight' || event.target.closest('.nav-tools__flyout')) return;
                            event.preventDefault();
                            cancelLeave();
                            setCreationOpen(true);
                            requestAnimationFrame(() => firstCreation.current?.focus());
                        }}>
                        <div className="nav-tools__split" data-open={creationOpen}>
                            <button type="button" className="nav-tools__row" aria-pressed={editing} onClick={() => finish(onEdit, true)}>
                                <span className="nav-tools__icon" aria-hidden="true">{editing ? <Check /> : <Pencil />}</span>
                                {editing ? '完成编辑' : '编辑'}
                            </button>
                            <button ref={disclosure} type="button" className="nav-tools__disclosure" aria-label="展开创建选项"
                                aria-expanded={creationOpen} aria-controls={creationId} onClick={() => setCreationOpen(value => !value)}>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        </div>
                        <div id={creationId} role="group" aria-label="创建选项" className="nav-tools__flyout nav-tools__surface"
                            data-open={open && creationOpen} inert={!open || !creationOpen}>
                            <button ref={firstCreation} type="button" className="nav-tools__row" onClick={() => finish(onAddContest, true)}>
                                <span className="nav-tools__icon" aria-hidden="true"><SquarePlus /></span>
                                创建竞赛卡片
                            </button>
                            <button type="button" className="nav-tools__row" onClick={() => finish(onAddAgent, true)}>
                                <span className="nav-tools__icon nav-tools__icon--agent" aria-hidden="true"><Bot /></span>
                                创建智能体
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const Navbar = ({
    isAdmin, canManageUsers, user, onLogout, onOpenProfile, activePage, setActivePage,
    siteConfig, searchTerm, setSearchTerm, onAdd, onAddTaskApp, immersiveMode,
    isCardEditMode, setIsCardEditMode,
    showCategoryArrange, categoryArrangeEnabled, onToggleCategoryArrange,
    // Announcement state controls the compact inbox entry.
    hasActiveAnnouncement, isAnnouncementVisible, onToggleAnnouncement,
    enteringFromLogin = false,
    onEntryTransitionEnd,
    activeThemeColor = 'blue',
    ticketUnread = 0,
    onOpenTickets
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

    const logoTile = brandLogoHasTile(siteConfig);
    const brandIntro = useBrandIntro();
    const searchPlaceholder = siteConfig?.searchPlaceholder || '搜索竞赛或类目...';
    const renderNavbarLogo = () => {
        const logoType = siteConfig?.navbarLogoType || siteConfig?.loginLogoType || 'Trophy';
        const logoUrl = siteConfig?.navbarLogoUrl || siteConfig?.customLogoUrl;
        return (
            <BrandLogo
                type={logoType}
                url={logoUrl}
                className="h-7 w-7 text-white"
                imageClassName={logoTile ? 'h-7 w-7 object-contain' : 'h-10 w-10 object-contain'}
            />
        );
    };

    const getSafeTitle = () => {
        const brandName = siteConfig?.loginBrandName;
        if (typeof brandName === 'string' && brandName.trim()) return brandName;
        const titleData = siteConfig?.loginTitle;
        if (!titleData) return DEFAULT_SITE_CONFIG.loginBrandName;
        return typeof titleData === 'object' ? (titleData.text || DEFAULT_SITE_CONFIG.loginBrandName) : titleData;
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
        <nav data-immersive={immersiveMode || undefined} className={`dashboard-navbar fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 lg:px-8 py-4 pointer-events-none ${
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
                    <button type="button" className={`dashboard-navbar-brand ${brandIntro ? 'brand-intro' : ''} flex min-w-0 items-center gap-3 cursor-pointer group z-10`} onClick={() => setActivePage('dashboard')} aria-label="返回竞赛首页">
                        <div className={`navbar-brand-mark brand-mark relative flex h-10 w-10 items-center justify-center rounded-xl ${logoTile ? `bg-gradient-to-tr ${navbarTheme.gradient} ${navbarTheme.shadow} shadow-lg` : ''} transition-transform duration-300 group-hover:scale-105`}>
                            {renderNavbarLogo()}
                            {isChristmas && <span className="absolute -top-3 -right-2 text-xl filter drop-shadow-sm rotate-12">🎅</span>}
                        </div>
                        <span className="hidden min-w-0 sm:block">
                            <BrandName name={getSafeTitle()} imageUrl={siteConfig?.loginBrandImageUrl} onDark={isHalloween || isMidAutumn} className={`block truncate bg-clip-text text-lg font-black tracking-tight text-transparent
                            ${isLunar ? 'bg-gradient-to-r from-red-800 to-orange-700' : ''}
                            ${isHalloween ? 'bg-gradient-to-r from-orange-400 to-purple-400' : ''}
                            ${isMidAutumn ? 'bg-gradient-to-r from-yellow-100 to-blue-200' : ''}
                            ${isDragonBoat ? 'bg-gradient-to-r from-teal-800 to-emerald-600' : ''}
                            ${isYuanxiao ? 'bg-gradient-to-r from-pink-600 to-purple-600' : ''}
                            ${isQingming ? 'bg-gradient-to-r from-slate-700 to-gray-500' : ''}
                            ${!isLunar && !isHalloween && !isMidAutumn && !isDragonBoat && !isYuanxiao && !isQingming ? 'bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300' : ''}
                            `} />
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
                                placeholder={searchPlaceholder}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Right Actions — every control is a NavButton so size,
                        glass surface, hover lift and press feedback match. */}
                    <div
                        className="dashboard-navbar-actions flex items-center gap-2 z-10"
                        onAnimationEnd={(event) => {
                            if (
                                enteringFromLogin
                                && event.target === event.currentTarget
                                && event.animationName === 'dashboard-navbar-control-in'
                            ) onEntryTransitionEnd?.();
                        }}
                    >
                        {showCategoryArrange && activePage === 'dashboard' && (
                            <NavButton
                                onClick={onToggleCategoryArrange}
                                pressed={categoryArrangeEnabled}
                                title={categoryArrangeEnabled ? '取消分类排列' : '按分类排列'}
                                icon={categoryArrangeEnabled ? Rows3 : LayoutGrid}
                                iconKey={categoryArrangeEnabled ? 'rows' : 'grid'}
                            >分类排列</NavButton>
                        )}

                        {hasActiveAnnouncement && !isAnnouncementVisible && activePage === 'dashboard' && (
                            <NavButton
                                onClick={onToggleAnnouncement}
                                variant="tinted"
                                iconOnly
                                title="有新公告"
                                ariaLabel="查看新公告"
                                icon={Megaphone}
                                className="nav-btn--pop"
                                iconClassName="nav-btn__icon--wiggle"
                                badge={<span className="nav-btn__ping" aria-hidden="true" />}
                            />
                        )}

                        {canManageUsers && activePage === 'dashboard' && (
                            <SystemToolsMenu onSettings={() => setActivePage('settings')} canEdit={isAdmin}
                                editing={isCardEditMode} onEdit={() => setIsCardEditMode(value => !value)}
                                onAddContest={onAdd} onAddAgent={onAddTaskApp} />
                        )}

                        {canManageUsers && activePage === 'settings' && (
                            <NavButton onClick={() => setActivePage('dashboard')} variant="primary" icon={LayoutDashboard} keepLabel>退出设置</NavButton>
                        )}

                        {onOpenTickets && (
                            <NavButton
                                onClick={onOpenTickets}
                                icon={LifeBuoy}
                                title={ticketUnread ? `工单（${ticketUnread} 条新动态）` : '工单'}
                                ariaLabel={ticketUnread ? `工单，${ticketUnread} 条新动态` : '工单'}
                                badge={ticketUnread > 0 && <span className="navbar-ticket-badge" aria-hidden="true">{ticketUnread > 99 ? '99+' : ticketUnread}</span>}
                            >工单</NavButton>
                        )}

                        <span className="nav-divider" aria-hidden="true" />

                        <NavButton onClick={onLogout} variant="ghost" icon={LogOut} iconAfter title="退出登录">退出</NavButton>

                        <button type="button" onClick={onOpenProfile} title="个人资料" aria-label="打开个人资料" className="nav-avatar">
                            {user?.avatarDataUrl ? <img src={user.avatarDataUrl} alt="" className="h-full w-full bg-white object-contain p-0.5" /> : Array.from(user?.username || 'M')[0]?.toUpperCase()}
                        </button>
                    </div>
                </div>
                {activePage === 'dashboard' && (
                    <div className="relative mt-3 md:hidden">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            aria-label={searchPlaceholder}
                            className={`w-full rounded-xl border border-transparent py-2.5 pl-10 pr-4 text-sm outline-none transition-all focus:border-indigo-200 ${GLASS_INPUT}`}
                            placeholder={searchPlaceholder}
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
