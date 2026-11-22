import React, { lazy, Suspense } from 'react';
import { THEMES } from '../../constants/themes';
import { IMMERSIVE_WALLPAPERS } from '../../constants/immersiveWallpapers';
import { prefersReducedMotion } from '../../utils/motionPreferences';
import AccentRaceScene from '../branding/AccentRaceScene';
import LayeredSvgScene from './LayeredSvgScene';
import { useSceneIntro } from './layeredScene';
import dawnScene from '../../../public/default-scene/competition-dawn.svg?raw';
import nightScene from '../../../public/default-scene/competition-night.svg?raw';

const ACCENT_LAYERS = ['sky', 'far', 'mid', 'front', 'focal', 'details'];
const accentReady = () => Promise.resolve();

// The theme-colour track follows the live accent variable, so its layers stay
// inline <svg> elements (an <img> could not inherit the CSS variable); each
// layer is still its own box, animated only with transform/opacity.
function AccentSceneLayers({ dark, animate }) {
    const { rootProps } = useSceneIntro('accent', animate, accentReady);
    return (
        <div aria-hidden="true" data-scene="accent" {...rootProps}>
            {ACCENT_LAYERS.map(role => (
                <AccentRaceScene key={role} dark={dark} layers={[role]} className={`layered-scene-layer layered-scene-layer--${role}`} />
            ))}
        </div>
    );
}

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
    showDefaultScene,
    suspendImmersive = false,
    onWallpaperLoad,
    onWallpaperError
}) {
    const immersiveWallpaper = effectMode === 'immersive' && Object.hasOwn(IMMERSIVE_WALLPAPERS, activeImmersive)
        ? IMMERSIVE_WALLPAPERS[activeImmersive]
        : null;
    const ActiveImmersiveEffect = immersiveWallpaper && !suspendImmersive && !prefersReducedMotion()
        ? IMMERSIVE_EFFECT_COMPONENTS[activeImmersive]
        : null;
    const isWallpaperSoftened = !currentUser && !isUnlocking;
    const showDefault = effectMode === 'default';
    const showNeutral = showDefault || effectMode === 'immersive' || (effectMode === 'wallpaper' && !hasWallpaper);
    const animateScene = systemEffects.wallpaperReveal !== false && !prefersReducedMotion();

    return (
        <>
            {ActiveImmersiveEffect && (
                <Suspense fallback={null}><ActiveImmersiveEffect active /></Suspense>
            )}
            {showNeutral && (
                <div className={`neutral-system-background pointer-events-none fixed inset-0 z-0 ${isDarkMode ? 'neutral-system-background--dark' : ''}`}/>
            )}
            {showDefault && showDefaultScene && (
                <div className="default-scene pointer-events-none fixed inset-0 z-0 overflow-hidden" data-scene-mode={isDarkMode ? 'night' : 'dawn'}>
                    <LayeredSvgScene
                        sceneKey="competition"
                        variant={isDarkMode ? 'night' : 'dawn'}
                        source={isDarkMode ? nightScene : dawnScene}
                        animate={animateScene}
                        focusY="58%"
                    />
                </div>
            )}
            {immersiveWallpaper && (
                <div
                    aria-hidden="true"
                    className={`immersive-wallpaper-layer pointer-events-none fixed inset-0 z-0 overflow-hidden ${currentUser && !suspendImmersive ? 'immersive-wallpaper-layer--dashboard' : ''}`}
                >
                    <LayeredSvgScene
                        key={immersiveWallpaper}
                        sceneKey={`immersive:${activeImmersive}`}
                        url={immersiveWallpaper}
                        animate={animateScene}
                        focusY="55%"
                    />
                </div>
            )}
            {effectMode === 'color' && (
                <div
                    className="accent-system-background pointer-events-none fixed inset-0 z-0 overflow-hidden"
                    style={{ '--system-accent-rgb': currentTheme.rgb || THEMES.blue.rgb }}
                    aria-hidden="true"
                >
                    <AccentSceneLayers dark={isDarkMode} animate={animateScene} />
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
                    {/* Pre-blurred copy for the login screen. Signing in only
                        fades its opacity, so the blur is rasterised once
                        instead of being recomputed on every animation frame. */}
                    <img
                        key={`${wallpaperUrl}-soft`}
                        src={wallpaperUrl}
                        decoding="async"
                        alt=""
                        aria-hidden="true"
                        className="wallpaper-soft-copy absolute inset-0 h-full w-full object-cover"
                    />
                    <div className={`absolute inset-0 ${isDarkMode ? 'bg-slate-950/45' : 'bg-slate-950/20'}`}/>
                    <div className={`wallpaper-login-scrim absolute inset-0 ${isDarkMode ? 'bg-slate-950/25' : 'bg-white/20'} ${isWallpaperSoftened ? 'opacity-100' : (isDarkMode ? 'opacity-40' : 'opacity-55')}`}/>
                    <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-slate-950/15"/>
                </div>
            )}
        </>
    );
}
