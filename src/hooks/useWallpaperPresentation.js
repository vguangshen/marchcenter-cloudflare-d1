import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../constants/themes';
import { wallpaperContentUrl } from '../constants/config';
import { extractImageThemeFromElement } from '../utils/imageTheme';
import { mark, recordImageResourceTiming } from '../utils/startupPerf';
import { wallpaperAccentCacheKey } from '../utils/wallpaperUrl';

const readCachedAccent = (url) => {
    const key = wallpaperAccentCacheKey(url);
    if (!key) return null;
    try {
        const cached = JSON.parse(localStorage.getItem(key) || 'null');
        return cached?.rgb && THEMES[cached.themeKey] ? cached : null;
    } catch {
        localStorage.removeItem(key);
        return null;
    }
};

export function useWallpaperPresentation({ isSiteConfigReady, effectMode, themeSettings }) {
    const [accent, setAccent] = useState(() => themeSettings.themeAccent ?? null);
    const [loadFailed, setLoadFailed] = useState(false);
    const authoritativeAccentRef = useRef(themeSettings.themeAccent);
    authoritativeAccentRef.current = themeSettings.themeAccent;

    const candidateUrl = useMemo(() => (
        isSiteConfigReady
        && effectMode === 'wallpaper'
        && ['bing', 'wallpaper'].includes(themeSettings.backgroundMode)
        && Number(themeSettings.wallpaperId) > 0
    ) ? wallpaperContentUrl(themeSettings.wallpaperId, themeSettings.wallpaperVersion) : '', [
        effectMode,
        isSiteConfigReady,
        themeSettings.backgroundMode,
        themeSettings.wallpaperId,
        themeSettings.wallpaperVersion
    ]);

    useEffect(() => {
        setAccent(themeSettings.themeAccent?.rgb
            ? themeSettings.themeAccent
            : (candidateUrl ? readCachedAccent(candidateUrl) : null));
    }, [candidateUrl, themeSettings.themeAccent]);

    useEffect(() => {
        setLoadFailed(false);
        if (candidateUrl) mark('wallpaperRequestStart');
    }, [candidateUrl]);

    const scheduleAccentExtraction = useCallback((image) => {
        const extractAccent = () => {
            try {
                const nextAccent = extractImageThemeFromElement(image);
                const key = wallpaperAccentCacheKey(image.src);
                if (key) localStorage.setItem(key, JSON.stringify(nextAccent));
                if (!authoritativeAccentRef.current?.rgb) setAccent(nextAccent);
            } catch (error) {
                console.warn('Wallpaper accent extraction failed:', error);
            }
        };
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(extractAccent, { timeout: 800 });
        } else {
            window.setTimeout(extractAccent, 800);
        }
    }, []);

    const handleLoad = useCallback((event) => {
        const image = event.currentTarget;
        recordImageResourceTiming(image.src);
        scheduleAccentExtraction(image);
    }, [scheduleAccentExtraction]);

    const handleError = useCallback(() => {
        setLoadFailed(true);
        const key = wallpaperAccentCacheKey(candidateUrl);
        if (key) localStorage.removeItem(key);
    }, [candidateUrl]);

    return {
        accent,
        hasWallpaper: Boolean(candidateUrl) && !loadFailed,
        wallpaperUrl: candidateUrl,
        handleWallpaperLoad: handleLoad,
        handleWallpaperError: handleError
    };
}
