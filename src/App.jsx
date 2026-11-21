import React, { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import LoginPage from './components/views/LoginPage';
import PasswordChangeReminder from './components/views/PasswordChangeReminder';
import FeedbackCenter from './components/feedback/FeedbackCenter';
import LoadErrorNotice from './components/feedback/LoadErrorNotice';
import SystemBackgroundLayers from './components/layouts/SystemBackgroundLayers';
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig, GLASS_CARD } from './constants/config';
import { DEFAULT_SYSTEM_EFFECTS, THEMES } from './constants/themes';
import { useAuthSession } from './hooks/useAuthSession';
import { useThemeController } from './hooks/useThemeController';
import { useWallpaperPresentation } from './hooks/useWallpaperPresentation';
import { api } from './utils/api';
import { notify } from './utils/uiFeedback';
import { CACHED_SITE_CONFIG_KEY, readStoredJson } from './utils/uiThemeSettings';
import { mark, measure } from './utils/startupPerf';

const loadDashboard = () => import('./Dashboard.jsx');
const Dashboard = lazy(loadDashboard);

export default function App() {
    const auth = useAuthSession();
    const {
        currentUser, token, authStatus, isUnlocking, isAdmin,
        completeLoginTransition, handleLoginSuccess
    } = auth;

    // Prefer the last valid cached configuration while the public endpoint loads.
    const [siteConfig, setSiteConfig] = useState(() => {
        const saved = readStoredJson(CACHED_SITE_CONFIG_KEY);
        return saved ? normalizeSiteConfig(saved) : DEFAULT_SITE_CONFIG;
    });
    const [siteConfigLoadError, setSiteConfigLoadError] = useState('');
    const [isSiteConfigReady, setIsSiteConfigReady] = useState(false);

    const persistSiteConfig = useCallback(async (newConfig) => {
        try {
            await api.post('/config/site', newConfig, { fallback: '站点配置保存失败' });
            setSiteConfig(newConfig);
            localStorage.setItem(CACHED_SITE_CONFIG_KEY, JSON.stringify(newConfig));
            return true;
        } catch (error) {
            notify(error.message, 'error');
            return false;
        }
    }, []);

    const saveGlobalTheme = useCallback((settings) => (
        persistSiteConfig({ ...siteConfig, globalTheme: settings })
    ), [persistSiteConfig, siteConfig]);
    const {
        uiThemeSettings, effectiveLightDark, isDarkMode,
        saveUiThemeSettings, handleLoginThemeToggle
    } = useThemeController({
        globalTheme: siteConfig.globalTheme,
        canSaveGlobal: Boolean(isAdmin && token),
        saveGlobalTheme
    });
    const effectMode = uiThemeSettings.effectMode || 'default';
    const activeImmersive = effectMode === 'immersive' ? uiThemeSettings.immersive : null;
    const systemEffects = {
        ...DEFAULT_SYSTEM_EFFECTS,
        ...(uiThemeSettings.systemEffects || {})
    };
    const {
        accent: wallpaperAccent,
        hasWallpaper,
        wallpaperUrl,
        handleWallpaperLoad,
        handleWallpaperError
    } = useWallpaperPresentation({
        isSiteConfigReady,
        effectMode,
        themeSettings: uiThemeSettings
    });

    const activeThemeColor = effectMode === 'color'
        ? (uiThemeSettings.manualColor || 'blue')
        : effectMode === 'wallpaper' && ['bing', 'wallpaper'].includes(uiThemeSettings.backgroundMode)
            ? (wallpaperAccent?.themeKey || 'blue') : 'blue';

    // Public site configuration
    const fetchSiteConfig = useCallback(async () => {
        let succeeded = false;
        mark('siteConfigRequestStart');
        try {
            const data = await api.get('/config/site', { fallback: '站点配置读取失败' });
            const config = normalizeSiteConfig(data.data || data);
            succeeded = true;

            if (Object.keys(config).length > 0) {
                setSiteConfig(config);
                localStorage.setItem(CACHED_SITE_CONFIG_KEY, JSON.stringify(config));
            }
            setIsSiteConfigReady(true);
        } catch (e) {
            setSiteConfigLoadError(e.message || '站点配置读取失败，请重试');
            const local = readStoredJson(CACHED_SITE_CONFIG_KEY);
            if (local) setSiteConfig(normalizeSiteConfig(local));
        } finally {
            mark('siteConfigRequestEnd');
            measure('siteConfigRequest', 'siteConfigRequestStart', 'siteConfigRequestEnd');
            if (succeeded) setSiteConfigLoadError('');
        }
    }, []);

    useEffect(() => { fetchSiteConfig(); }, [fetchSiteConfig]);

    const paletteTheme = THEMES[activeThemeColor] || THEMES.blue;
    const currentTheme = (
        effectMode === 'wallpaper'
        && ['bing', 'wallpaper'].includes(uiThemeSettings.backgroundMode)
        && wallpaperAccent?.rgb
    ) ? { ...paletteTheme, rgb: wallpaperAccent.rgb } : paletteTheme;
    const accentStyle = { '--system-accent-rgb': currentTheme.rgb || THEMES.blue.rgb };
    const renderBackground = (suspendImmersive = false) => (
        <SystemBackgroundLayers
            effectMode={effectMode}
            activeImmersive={activeImmersive}
            systemEffects={systemEffects}
            currentUser={currentUser}
            isUnlocking={isUnlocking}
            isDarkMode={isDarkMode}
            currentTheme={currentTheme}
            hasWallpaper={hasWallpaper}
            wallpaperUrl={wallpaperUrl}
            suspendImmersive={suspendImmersive}
            onWallpaperLoad={handleWallpaperLoad}
            onWallpaperError={handleWallpaperError}
        />
    );

    const renderLoading = label => (
        <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative`} style={accentStyle}>
            {renderBackground()}
            <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
                <div role="status" aria-live="polite" className={`${GLASS_CARD} flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold text-slate-600 shadow-xl dark:text-slate-200`}>
                    <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                    {label}
                </div>
            </div>
        </div>
    );

    if (authStatus === 'checking') return renderLoading('正在验证登录状态…');

    if (!currentUser) {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative ${
                systemEffects.loginEntrance === false ? 'system-effects-no-login-entrance' : ''
            } ${effectMode === 'default' ? 'system-background-default' : ''}`} style={accentStyle}>

                <FeedbackCenter />
                <div className="fixed left-1/2 top-4 z-[200] w-[min(92vw,560px)] -translate-x-1/2">
                    <LoadErrorNotice message={siteConfigLoadError} onRetry={fetchSiteConfig} />
                </div>
                {renderBackground()}

                <div className="relative z-10 min-h-screen flex flex-col">
                    <div className="flex-grow flex items-center justify-center">
                        <LoginPage
                            onLogin={(user, authToken) => {
                                void loadDashboard().catch(() => {});
                                handleLoginSuccess(user, authToken, { animate: systemEffects.loginEntrance !== false });
                            }}
                            activeThemeColor={activeThemeColor}
                            siteConfig={siteConfig}
                            isDarkMode={isDarkMode}
                            onThemeToggle={handleLoginThemeToggle}
                            immersiveMode={activeImmersive}
                            wallpaperActive={hasWallpaper}
                            isUnlocking={isUnlocking}
                            onUnlockTransitionEnd={completeLoginTransition}
                            systemEffects={systemEffects}
                        />
                    </div>
                </div>
            </div>
        );
    }

    // An administrator-reset account must choose a new password before the
    // workbench (and every request it makes) is allowed to load.
    if (currentUser.passwordChangeRecommended) {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative`} style={accentStyle}>
                <FeedbackCenter />
                {renderBackground()}
                <PasswordChangeReminder
                    username={currentUser.username}
                    onLogout={auth.handleLogout}
                    onComplete={() => notify('密码已更新，欢迎回来', 'success')}
                />
            </div>
        );
    }

    return (
        <Suspense fallback={renderLoading('正在加载工作台…')}>
            <Dashboard auth={auth}
                site={{ siteConfig, siteConfigLoadError, fetchSiteConfig, persistSiteConfig }}
                appearance={{ isDarkMode, uiThemeSettings, effectiveLightDark, saveUiThemeSettings,
                    activeThemeColor, activeImmersive, systemEffects, accentStyle, renderBackground }} />
        </Suspense>
    );
}
