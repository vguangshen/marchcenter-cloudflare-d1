import React, { lazy, Suspense } from 'react';
import { THEMES } from '../../constants/themes';
import { prefersReducedMotion } from '../../utils/motionPreferences';

const IMMERSIVE_EFFECT_COMPONENTS = Object.freeze({
    christmas: lazy(() => import('../effects/SnowSystem')),
    lunar_new_year: lazy(() => import('../effects/FireworksSystem')),
    halloween: lazy(() => import('../effects/BatSystem')),
    mid_autumn: lazy(() => import('../effects/LanternSystem')),
    dragon_boat: lazy(() => import('../effects/DragonBoatSystem')),
    yuanxiao: lazy(() => import('../effects/YuanxiaoSystem')),
    qingming: lazy(() => import('../effects/RainSystem'))
});

export default function SystemBackgroundLayers({
    effectMode,
    activeImmersive,
    systemEffects,
    currentUser,
    isUnlocking,
    isDarkMode,
    currentTheme,
    hasWallpaper,
    wallpaperUrl,
    suspendImmersive = false,
    onWallpaperLoad,
    onWallpaperError
}) {
    const ActiveImmersiveEffect = activeImmersive && !suspendImmersive && !prefersReducedMotion()
        ? IMMERSIVE_EFFECT_COMPONENTS[activeImmersive]
        : null;
    const isWallpaperSoftened = !currentUser && !isUnlocking;
    const showAfterRain = effectMode === 'default' && Boolean(currentUser);
    const showNeutral = (
        (effectMode === 'default' && !currentUser)
        || effectMode === 'immersive'
        || (effectMode === 'wallpaper' && !hasWallpaper)
    );

    return (
        <>
            {ActiveImmersiveEffect && (
                <Suspense fallback={null}><ActiveImmersiveEffect active /></Suspense>
            )}
            {showNeutral && (
                <div className={`neutral-system-background pointer-events-none fixed inset-0 z-0 ${isDarkMode ? 'neutral-system-background--dark' : ''}`}/>
            )}
            {showAfterRain && (
                <div className={`after-rain-background pointer-events-none fixed inset-0 z-0 overflow-hidden ${isDarkMode ? 'after-rain-background--dark' : ''}`}>
                    <div className="after-rain-background__haze"/>
                    <div className="after-rain-background__reflection"/>
                    <div className="after-rain-background__panes"/>
                    <div className="after-rain-background__grid"/>
                    <div className="after-rain-background__streaks"/>
                    <div className="after-rain-background__droplets"/>
                </div>
            )}
            {effectMode === 'color' && (
                <div
                    className={`accent-system-background pointer-events-none fixed inset-0 z-0 overflow-hidden ${isDarkMode ? 'accent-system-background--dark' : ''}`}
                    style={{ '--system-accent-rgb': currentTheme.rgb || THEMES.blue.rgb }}
                >
                    <div className="accent-system-background__grid"/>
                    <div className="accent-system-background__glow accent-system-background__glow--top"/>
                    <div className="accent-system-background__glow accent-system-background__glow--bottom"/>
                    <div className="accent-system-background__orbit accent-system-background__orbit--left"/>
                    <div className="accent-system-background__orbit accent-system-background__orbit--right"/>
                    <div className="accent-system-background__track accent-system-background__track--top"><span/><span/><span/></div>
                    <div className="accent-system-background__track accent-system-background__track--bottom"><span/><span/></div>
                </div>
            )}
            {hasWallpaper && (
                <div
                    className={`wallpaper-background-layer pointer-events-none fixed inset-0 z-[1] ${isWallpaperSoftened ? 'wallpaper-background-layer--login' : 'wallpaper-background-layer--dashboard'} ${systemEffects.wallpaperReveal === false ? 'wallpaper-background-layer--no-transition' : ''}`}
                    data-wallpaper-state={isWallpaperSoftened ? 'softened' : 'ambient'}
                >
                    <img
                        key={wallpaperUrl}
                        src={wallpaperUrl}
                        loading="eager"
                        decoding="async"
                        fetchPriority="high"
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full object-cover"
                        onLoad={onWallpaperLoad}
                        onError={onWallpaperError}
                    />
                    <div className={`absolute inset-0 ${isDarkMode ? 'bg-slate-950/45' : 'bg-slate-950/20'}`}/>
                    <div className={`wallpaper-login-scrim absolute inset-0 ${isDarkMode ? 'bg-slate-950/25' : 'bg-white/20'} ${isWallpaperSoftened ? 'opacity-100' : (isDarkMode ? 'opacity-40' : 'opacity-55')}`}/>
                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-slate-950/15"/>
                </div>
            )}
        </>
    );
}
