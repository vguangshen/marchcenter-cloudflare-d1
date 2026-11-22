import { useCallback, useEffect, useState } from 'react';
import { useAutoLightDark } from '../utils/autoDayNight';
import {
    LOCAL_THEME_PREFERENCE_KEY,
    mergeLocalLightDark,
    normalizeUiThemeSettings,
    patchUiThemeSettings,
    readStoredUiThemeSettings,
    storeLocalLightDark
} from '../utils/uiThemeSettings';

export function useThemeController({ globalTheme, canSaveGlobal, saveGlobalTheme }) {
    const [settings, setSettings] = useState(readStoredUiThemeSettings);
    const [appliedGlobalTheme, setAppliedGlobalTheme] = useState(globalTheme);

    useEffect(() => {
        if (globalTheme) {
            setSettings(mergeLocalLightDark(normalizeUiThemeSettings(globalTheme)));
        }
        setAppliedGlobalTheme(globalTheme);
    }, [globalTheme]);

    const effectiveLightDark = useAutoLightDark(settings.lightDark);
    const isDarkMode = effectiveLightDark === 'dark';

    const saveSettings = useCallback(async (changes, options = {}) => {
        if (canSaveGlobal) {
            const saved = await saveGlobalTheme(changes, options);
            if (!saved) return false;
            localStorage.removeItem(LOCAL_THEME_PREFERENCE_KEY);
            setSettings(saved);
            return true;
        }
        if (options.requiredMode && settings.effectMode !== options.requiredMode) return false;
        const normalized = patchUiThemeSettings(settings, changes);
        setSettings(normalized);
        storeLocalLightDark(normalized.lightDark);
        return true;
    }, [canSaveGlobal, saveGlobalTheme, settings]);

    const toggleLoginTheme = useCallback(() => {
        const newMode = isDarkMode ? 'light' : 'dark';
        setSettings(previous => ({ ...previous, lightDark: newMode }));
        storeLocalLightDark(newMode);
    }, [isDarkMode]);

    return {
        uiThemeSettings: settings,
        isGlobalThemeApplied: globalTheme === appliedGlobalTheme,
        setUiThemeSettings: setSettings,
        effectiveLightDark,
        isDarkMode,
        saveUiThemeSettings: saveSettings,
        handleLoginThemeToggle: toggleLoginTheme
    };
}
