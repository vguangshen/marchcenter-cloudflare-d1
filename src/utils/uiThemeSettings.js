import { DEFAULT_SITE_CONFIG } from '../constants/config';
import { DEFAULT_SYSTEM_EFFECTS, THEMES } from '../constants/themes';

export const LOCAL_THEME_PREFERENCE_KEY = 'competition_hub_local_pref';
export const CACHED_SITE_CONFIG_KEY = 'competition_hub_site_config';

export const DEFAULT_UI_THEME_SETTINGS = Object.freeze({
    effectMode: 'default',
    manualColor: 'blue',
    lightDark: 'light',
    immersive: null,
    backgroundMode: 'default',
    wallpaperId: null,
    wallpaperVersion: null,
    themeAccent: null,
    systemEffects: DEFAULT_SYSTEM_EFFECTS
});

export const readStoredJson = (key, fallback = null) => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        localStorage.removeItem(key);
        return fallback;
    }
};

export const normalizeUiThemeSettings = (value) => {
    const settings = value && typeof value === 'object' ? value : {};
    const effectMode = ['default', 'immersive', 'wallpaper', 'color'].includes(settings.effectMode)
        ? settings.effectMode
        : DEFAULT_UI_THEME_SETTINGS.effectMode;
    const backgroundMode = effectMode === 'wallpaper'
        ? (['bing', 'wallpaper'].includes(settings.backgroundMode) ? settings.backgroundMode : 'bing')
        : 'default';
    return {
        effectMode,
        manualColor: THEMES[settings.manualColor] ? settings.manualColor : DEFAULT_UI_THEME_SETTINGS.manualColor,
        lightDark: ['auto', 'light', 'dark'].includes(settings.lightDark)
            ? settings.lightDark
            : DEFAULT_UI_THEME_SETTINGS.lightDark,
        immersive: effectMode === 'immersive' && settings.immersive ? settings.immersive : null,
        backgroundMode,
        wallpaperId: Number.isInteger(Number(settings.wallpaperId)) && Number(settings.wallpaperId) > 0
            ? Number(settings.wallpaperId)
            : null,
        wallpaperVersion: (
            typeof settings.wallpaperVersion === 'string'
            && /^[A-Za-z0-9_-]{1,128}$/.test(settings.wallpaperVersion)
        ) ? settings.wallpaperVersion : null,
        themeAccent: (
            settings.themeAccent
            && typeof settings.themeAccent === 'object'
            && THEMES[settings.themeAccent.themeKey]
            && typeof settings.themeAccent.rgb === 'string'
            && /^\d{1,3}( \d{1,3}){2}$/.test(settings.themeAccent.rgb)
        ) ? { themeKey: settings.themeAccent.themeKey, rgb: settings.themeAccent.rgb } : null,
        systemEffects: {
            ...DEFAULT_SYSTEM_EFFECTS,
            ...(settings.systemEffects && typeof settings.systemEffects === 'object'
                ? settings.systemEffects
                : {})
        }
    };
};

export const mergeLocalLightDark = (globalThemeSettings) => {
    const localTheme = readStoredJson(LOCAL_THEME_PREFERENCE_KEY);
    if (localTheme && ['light', 'dark'].includes(localTheme.lightDark)) {
        return { ...globalThemeSettings, lightDark: localTheme.lightDark };
    }
    return globalThemeSettings;
};

export const readStoredUiThemeSettings = () => {
    const cachedSiteConfig = readStoredJson(CACHED_SITE_CONFIG_KEY, DEFAULT_SITE_CONFIG);
    const cachedGlobalTheme = cachedSiteConfig?.globalTheme
        ? normalizeUiThemeSettings(cachedSiteConfig.globalTheme)
        : DEFAULT_UI_THEME_SETTINGS;
    return mergeLocalLightDark(cachedGlobalTheme);
};

export const storeLocalLightDark = (lightDark) => {
    if (!['light', 'dark'].includes(lightDark)) {
        localStorage.removeItem(LOCAL_THEME_PREFERENCE_KEY);
        return;
    }
    localStorage.setItem(LOCAL_THEME_PREFERENCE_KEY, JSON.stringify({ lightDark }));
};
