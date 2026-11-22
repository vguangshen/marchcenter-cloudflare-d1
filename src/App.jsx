import React, { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import LoginPage from './components/views/LoginPage';
import PasswordChangeReminder from './components/views/PasswordChangeReminder';
import AccountSecurityReminder from './components/views/AccountSecurityReminder';
import { isPasswordChangeEnforced, passwordChangeDue } from './components/views/accountSecurity';
import FeedbackCenter from './components/feedback/FeedbackCenter';
import LoadErrorNotice from './components/feedback/LoadErrorNotice';
import SystemBackgroundLayers from './components/layouts/SystemBackgroundLayers';
import { DEFAULT_SITE_CONFIG, normalizeSiteConfig, GLASS_CARD } from './constants/config';
import { DEFAULT_SYSTEM_EFFECTS, THEMES } from './constants/themes';
import { useAuthSession } from './hooks/useAuthSession';
import { useThemeController } from './hooks/useThemeController';
import { useWallpaperPresentation } from './hooks/useWallpaperPresentation';
import { api } from './utils/api';
import { getTabToken } from './utils/tabSession';
import { notify } from './utils/uiFeedback';
import { CACHED_SITE_CONFIG_KEY, normalizeUiThemeSettings, patchUiThemeSettings, readStoredJson } from './utils/uiThemeSettings';
import { mark, measure } from './utils/startupPerf';

// Once the chunk has loaded, render the component directly: React.lazy would
// still suspend for one tick and flash the loading card right after the login
// bar has docked.
let LoadedDashboard = null;
const loadDashboard = () => import('./Dashboard.jsx').then(module => {
    LoadedDashboard = module.default;
    return module;
});
const LazyDashboard = lazy(loadDashboard);

// Picks the component once per mount so it never switches type (which would
// remount the whole dashboard) when the chunk finishes loading later.
function DashboardHost(props) {
    const [View] = useState(() => LoadedDashboard || LazyDashboard);
    return <View {...props} />;
}

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
    const currentSiteConfig = useRef(siteConfig);
    const siteConfigSaveQueue = useRef(Promise.resolve());

    const commitSiteConfig = useCallback((config) => {
        currentSiteConfig.current = config;
        setSiteConfig(config);
    }, []);

    const persistSiteConfig = useCallback((changes) => {
        // Each panel edits its own fields. Build the full payload after earlier saves finish.
        const save = siteConfigSaveQueue.current.then(async () => {
            if (!token || getTabToken() !== token) return false;
            try {
                const current = currentSiteConfig.current;
                const patch = typeof changes === 'function' ? changes(current) : changes;
                if (!patch) return false;
                const newConfig = { ...current, ...patch };
                const saved = await api.post('/config/site', newConfig, { fallback: '站点配置保存失败' });
                const savedConfig = normalizeSiteConfig(saved?.config || newConfig);
                commitSiteConfig(savedConfig);
                localStorage.setItem(CACHED_SITE_CONFIG_KEY, JSON.stringify(savedConfig));
                return true;
            } catch (error) {
                notify(error.message, 'error');
                return false;
            }
        });
        siteConfigSaveQueue.current = save;
        return save;
    }, [commitSiteConfig, token]);

    const saveGlobalTheme = useCallback(async (changes, { requiredMode } = {}) => {
        const saved = await persistSiteConfig(({ globalTheme }) => {
            const current = normalizeUiThemeSettings(globalTheme);
            if (requiredMode && current.effectMode !== requiredMode) return null;
            return { globalTheme: patchUiThemeSettings(current, changes) };
        });
        return saved && currentSiteConfig.current.globalTheme;
    }, [persistSiteConfig]);
    const {
        uiThemeSettings, effectiveLightDark, isDarkMode, isGlobalThemeApplied,
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
        const initialConfig = currentSiteConfig.current;
        let succeeded = false;
        mark('siteConfigRequestStart');
        try {
            const data = await api.get('/config/site', { fallback: '站点配置读取失败' });
            const config = normalizeSiteConfig(data.data || data);
            succeeded = true;

            if (currentSiteConfig.current === initialConfig) {
                commitSiteConfig(config);
                localStorage.setItem(CACHED_SITE_CONFIG_KEY, JSON.stringify(config));
            }
            setIsSiteConfigReady(true);
        } catch (e) {
            setSiteConfigLoadError(e.message || '站点配置读取失败，请重试');
            const local = readStoredJson(CACHED_SITE_CONFIG_KEY);
            if (local && currentSiteConfig.current === initialConfig) commitSiteConfig(normalizeSiteConfig(local));
        } finally {
            mark('siteConfigRequestEnd');
            measure('siteConfigRequest', 'siteConfigRequestStart', 'siteConfigRequestEnd');
            if (succeeded) setSiteConfigLoadError('');
        }
    }, [commitSiteConfig]);

    useEffect(() => { fetchSiteConfig(); }, [fetchSiteConfig]);

    // The reminder becomes a lock when the grace period ends, even mid-session.
    const [securityClock, setSecurityClock] = useState(() => Date.now());
    const passwordDue = passwordChangeDue(currentUser, securityClock);
    const passwordChangeEnforced = isPasswordChangeEnforced(currentUser, securityClock);
    useEffect(() => {
        if (passwordDue === null || passwordChangeEnforced) return undefined;
        const timer = window.setTimeout(() => setSecurityClock(Date.now()),
            Math.min(Math.max(passwordDue - Date.now(), 0) + 500, 2 ** 31 - 1));
        return () => window.clearTimeout(timer);
    }, [passwordDue, passwordChangeEnforced]);
    const { updateCurrentUser } = auth;
    const handleSecurityProfileUpdated = useCallback(user => {
        if (user) updateCurrentUser(user);
        notify('邮箱已绑定', 'success');
    }, [updateCurrentUser]);

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
            showDefaultScene={isGlobalThemeApplied && (isSiteConfigReady || Boolean(siteConfigLoadError))}
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

    // After the reminder period, an administrator-chosen password must be
    // replaced before the workbench (and every request it makes) can load.
    if (passwordChangeEnforced) {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative`} style={accentStyle}>
                <FeedbackCenter />
                {renderBackground()}
                <PasswordChangeReminder
                    user={currentUser}
                    onUserUpdated={handleSecurityProfileUpdated}
                    onLogout={auth.handleLogout}
                    onComplete={() => notify('密码已更新，欢迎回来', 'success')}
                />
            </div>
        );
    }

    return (
        <>
            <Suspense fallback={renderLoading('正在加载工作台…')}>
                <DashboardHost auth={auth}
                    site={{ siteConfig, siteConfigLoadError, fetchSiteConfig, persistSiteConfig }}
                    appearance={{ isDarkMode, uiThemeSettings, effectiveLightDark, saveUiThemeSettings,
                        activeThemeColor, activeImmersive, systemEffects, accentStyle, renderBackground }} />
            </Suspense>
            <AccountSecurityReminder
                key={currentUser.id}
                user={currentUser}
                isDarkMode={isDarkMode}
                onUserUpdated={handleSecurityProfileUpdated}
                onPasswordChanged={() => notify('密码已更新', 'success')}
            />
        </>
    );
}
