import { useCallback, useEffect, useState } from 'react';
import { useAutoLightDark } from '../utils/autoDayNight';
import {
    LOCAL_THEME_PREFERENCE_KEY,
    mergeLocalLightDark,
    normalizeUiThemeSettings,
    readStoredUiThemeSettings,
    storeLocalLightDark
} from '../utils/uiThemeSettings';

export function useThemeController({ globalTheme, canSaveGlobal, saveGlobalTheme }) {
    const [settings, setSettings] = useState(readStoredUiThemeSettings);

    useEffect(() => {
        if (globalTheme) {
            setSettings(mergeLocalLightDark(normalizeUiThemeSettings(globalTheme)));
        }
    }, [globalTheme]);

    const effectiveLightDark = useAutoLightDark(settings.lightDark);
    const isDarkMode = effectiveLightDark === 'dark';

    const saveSettings = useCallback(async (nextSettings) => {
        const normalized = normalizeUiThemeSettings(nextSettings);
        if (canSaveGlobal) {
            const saved = await saveGlobalTheme(normalized);
            if (!saved) return false;
            localStorage.removeItem(LOCAL_THEME_PREFERENCE_KEY);
            setSettings(normalized);
            return true;
        }
        setSettings(normalized);
        storeLocalLightDark(normalized.lightDark);
        return true;
    }, [canSaveGlobal, saveGlobalTheme]);

    const toggleLoginTheme = useCallback(() => {
        const newMode = isDarkMode ? 'light' : 'dark';
        setSettings(previous => ({ ...previous, lightDark: newMode }));
        storeLocalLightDark(newMode);
    }, [isDarkMode]);

    return {
        uiThemeSettings: settings,
        setUiThemeSettings: setSettings,
        effectiveLightDark,
        isDarkMode,
        saveUiThemeSettings: saveSettings,
        handleLoginThemeToggle: toggleLoginTheme
    };
}
