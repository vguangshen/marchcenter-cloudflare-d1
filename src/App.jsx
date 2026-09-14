import React, { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
    Sparkles, Network, Key, Users, Megaphone, Gift, Type, Palette,
    RefreshCw, Quote,
    Database, Loader2, AlertTriangle, Mail, Edit2, Trash2
} from 'lucide-react';

// --- 组件引入 ---
import LoginPage from './components/views/LoginPage';
import PasswordChangeReminder from './components/views/PasswordChangeReminder';
import Navbar from './components/layouts/Navbar';
import ContestCard from './components/cards/ContestCard';
import AgentTaskCard from './components/cards/AgentTaskCard';
import AnnouncementBanner from './components/views/dashboard/AnnouncementBanner';
import FeedbackCenter from './components/feedback/FeedbackCenter';
import { api } from './utils/api';
import { confirmAction, notify } from './utils/uiFeedback';
import LoadErrorNotice from './components/feedback/LoadErrorNotice';
import SystemBackgroundLayers from './components/layouts/SystemBackgroundLayers';
import DeleteUserModal from './components/modals/DeleteUserModal';

// --- 配置 ---
import {
    DEFAULT_AI_CONFIG, DEFAULT_SITE_CONFIG, normalizeSiteConfig,
    GLASS_CARD, INK_TEXT_SHADOW
} from './constants/config';
import { DEFAULT_SYSTEM_EFFECTS, THEMES } from './constants/themes';
import { mark, measure } from './utils/startupPerf';
import { prefersReducedMotion } from './utils/motionPreferences';
import { useAuthSession } from './hooks/useAuthSession';
import { useThemeController } from './hooks/useThemeController';
import { useCompetitionActions } from './hooks/useCompetitionActions';
import { useCompetitionCatalog } from './hooks/useCompetitionCatalog';
import { useWallpaperPresentation } from './hooks/useWallpaperPresentation';
import { CACHED_SITE_CONFIG_KEY, readStoredJson } from './utils/uiThemeSettings';

// 智能体平台标识
const AGENT_PLATFORM_LABELS = {
    KJDZSWRJXT: 'PT0401 · 跨境电子商务人机协同产教融合平台',
    scyxcjrh: 'PT0402 · 市场营销人机协同通用能力平台',
    kjrjxt09: 'PT0403 · 财经人机协同产教融合平台',
    dzswcjrh: 'PT0404 · 电子商务人机协同产教融合平台'
};

const BUILTIN_PLATFORM_OVERRIDES_KEY = 'marchcenter:paas-v2:builtin-overrides';

function readBuiltinPlatformOverrides() {
    try {
        const raw = localStorage.getItem(BUILTIN_PLATFORM_OVERRIDES_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}

const CUSTOM_PLATFORMS_KEY = 'marchcenter:paas-v2:custom-platforms';

function readCustomPlatformsMeta() {
    try {
        const raw = localStorage.getItem(CUSTOM_PLATFORMS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return {};
        const map = {};
        for (const item of parsed) {
            if (item && item.softwareUnique) map[item.softwareUnique] = { code: String(item.code || ''), name: String(item.name || '') };
        }
        return map;
    } catch { return {}; }
}

// 后台、节日特效和大型弹窗仅在真正使用时下载，避免占用登录页首包。
const ApiEngine = lazy(() => import('./components/views/settings/ApiEngine'));
const SsoManager = lazy(() => import('./components/views/settings/SsoManager'));
const UserManager = lazy(() => import('./components/views/settings/UserManager'));
const GiftManager = lazy(() => import('./components/views/settings/GiftManager'));
const ContentManager = lazy(() => import('./components/views/settings/ContentManager'));
const AppearanceManager = lazy(() => import('./components/views/settings/AppearanceManager'));
const AnnouncementManager = lazy(() => import('./components/views/settings/AnnouncementManager'));
const DatabaseManager = lazy(() => import('./components/views/settings/DatabaseManager'));
const AccountManagementApiManager = lazy(() => import('./components/views/settings/AccountManagementApiManager'));
const EmailServiceManager = lazy(() => import('./components/views/settings/EmailServiceManager'));

const AddUserModal = lazy(() => import('./components/modals/AddUserModal'));
const EditModal = lazy(() => import('./components/modals/EditModal'));
const TaskAppModal = lazy(() => import('./components/modals/TaskAppModal'));
const PermissionModal = lazy(() => import('./components/modals/PermissionModal'));
const AiGuideModal = lazy(() => import('./components/modals/AiGuideModal'));
const GiftModal = lazy(() => import('./components/modals/GiftModal'));
const EditGiftModal = lazy(() => import('./components/modals/EditGiftModal'));
export default function App() {
    // Application state
    const {
        currentUser, token, authStatus, isUnlocking, isNavbarTransitioning,
        completeLoginTransition, completeNavbarTransition, refreshCurrentUser,
        isAdmin, canManageUsers, handleLoginSuccess, handleLogout
    } = useAuthSession();
    const [activePage, setActivePage] = useState('dashboard');

    const [isCardEditMode, setIsCardEditMode] = useState(false);

    // Data
    const [users, setUsers] = useState([]);
    const [usersLoadError, setUsersLoadError] = useState('');
    const [usersPage, setUsersPage] = useState(1);
    const [usersPageSize] = useState(50);
    const [usersTotal, setUsersTotal] = useState(0);
    const [usersSearch, setUsersSearch] = useState('');
    const [debouncedUsersSearch, setDebouncedUsersSearch] = useState('');
    const usersRequestIdRef = useRef(0);
    const [classOptions, setClassOptions] = useState([]);
    const [ssoConfigsLoadError, setSsoConfigsLoadError] = useState('');
    const [announcements, setAnnouncements] = useState([]);
    const [gifts, setGifts] = useState([]);
    const [contentLoadError, setContentLoadError] = useState('');
    const [ssoConfigs, setSsoConfigs] = useState([]);
    const contentRevisionRef = useRef({ announcements: '', gifts: '' });
    const contentRequestRef = useRef(null);
    const [isPageVisible, setIsPageVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');

    // Config
    const [permissions, setPermissions] = useState({});
    const [userTimeRules, setUserTimeRules] = useState({});
    const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG);
    const [passwordReminderDismissed, setPasswordReminderDismissed] = useState(false);

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
    const {
        links, setLinks, linksPhase, linksLoadError,
        studentAccountsByCard, setStudentAccountsByCard, studentAccountsLoadError,
        fetchLinks, fetchStudentAccounts, completeLinksReveal, resetCompetitionCatalog
    } = useCompetitionCatalog({
        token,
        currentUser,
        revealEnabled: uiThemeSettings.systemEffects.dashboardCardReveal !== false
    });
    const {
        createPanel, setCreatePanel, creatingStudentCardId, deletingStudentKey,
        classActionKey, openingCompetitionKeys,
        handleCreateStudent, handleDeleteStudent, handleDeleteClass,
        handleInitializeClass, handleRepairAccountReadiness, handleRestoreClass, handleUnsupportedClassDelete,
        handleOpenCompetition, handleRequestManualCredential, handleOpenAdminEntry
    } = useCompetitionActions({
        token,
        currentUser,
        setLinks,
        studentAccountsByCard,
        setStudentAccountsByCard
    });

    const [activeThemeColor, setActiveThemeColor] = useState('blue');
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

    // UI
    const [searchTerm, setSearchTerm] = useState('');
    // 每次进入默认采用连续排列；用户主动点击后，本次页面会话才按分类分行。
    const [categoryArrangeEnabled, setCategoryArrangeEnabled] = useState(false);
    const categoryTransitionRef = useRef(null);
    const [settingsTab, setSettingsTab] = useState(() => currentUser?.role === 'super_admin' ? 'api' : 'users');
    const [usersLoading, setUsersLoading] = useState(false);

    // Modals
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isTaskAppModalOpen, setIsTaskAppModalOpen] = useState(false);
    const [taskAppSoftwareUnique, setTaskAppSoftwareUnique] = useState('');
    const [platformOverrideTick, setPlatformOverrideTick] = useState(0);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
    const [isEditGiftModalOpen, setIsEditGiftModalOpen] = useState(false);
    const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
    const [isDeleteUserModalOpen, setIsDeleteUserModalOpen] = useState(false);

    // 🎁 礼物状态管理
    const [isGiftMinimized, setIsGiftMinimized] = useState(false);
    const [activeGift, setActiveGift] = useState(null);

    // 📢 公告状态管理
    const [isAnnouncementVisible, setIsAnnouncementVisible] = useState(true);
    const [isAnnouncementClosing, setIsAnnouncementClosing] = useState(false);
    const [announcementNow, setAnnouncementNow] = useState(() => Date.now());
    const serverTimeOffsetRef = useRef(0);
    const announcementCloseAnimationTimerRef = useRef(null);

    // Selection
    const [editingLink, setEditingLink] = useState(null);
    const [currentAiLink, setCurrentAiLink] = useState(null);
    const [targetUserForPermission, setTargetUserForPermission] = useState(null);
    const [editingGift, setEditingGift] = useState(null);

    // Forms
    const [giftForm, setGiftForm] = useState({ title: '', content: '', type: 'link', targetUsers: [] });

    const activeAnnouncement = useMemo(() => announcements.find(item => {
        const closeAt = item.closeAt ? new Date(item.closeAt).getTime() : null;
        const isScheduled = !closeAt || Number.isNaN(closeAt) || closeAt > announcementNow;
        return isScheduled && (
            currentUser?.role === 'super_admin' || !item.targetType || item.targetType === 'all' || item.targetType === currentUser?.role
        );
    }) || null, [announcements, currentUser?.role, announcementNow]);

    // Announcement dismissal animation
    const triggerCloseAnnouncement = useCallback(() => {
        window.clearTimeout(announcementCloseAnimationTimerRef.current);
        setIsAnnouncementClosing(true);
        announcementCloseAnimationTimerRef.current = window.setTimeout(() => {
            setIsAnnouncementVisible(false);
            setIsAnnouncementClosing(false);
        }, 700);
    }, []);

    // ⏳ 倒计时逻辑
    useEffect(() => {
        if (!activeAnnouncement || !isAnnouncementVisible || isAnnouncementClosing || Number(activeAnnouncement.duration) <= 0) return undefined;
        const timer = window.setTimeout(triggerCloseAnnouncement, Number(activeAnnouncement.duration) * 1000);
        return () => window.clearTimeout(timer);
    }, [activeAnnouncement, isAnnouncementVisible, isAnnouncementClosing, triggerCloseAnnouncement]);

    useEffect(() => {
        if (!activeAnnouncement || !isAnnouncementVisible || isAnnouncementClosing || !activeAnnouncement.closeAt) return undefined;
        const closeAt = new Date(activeAnnouncement.closeAt).getTime();
        const remaining = closeAt - announcementNow;
        if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
        const timer = window.setTimeout(triggerCloseAnnouncement, remaining);
        return () => window.clearTimeout(timer);
    }, [activeAnnouncement, isAnnouncementVisible, isAnnouncementClosing, announcementNow, triggerCloseAnnouncement]);

    useEffect(() => {
        window.clearTimeout(announcementCloseAnimationTimerRef.current);
        setIsAnnouncementVisible(Boolean(activeAnnouncement));
        setIsAnnouncementClosing(false);
    }, [activeAnnouncement]);

    useEffect(() => () => window.clearTimeout(announcementCloseAnimationTimerRef.current), []);

    useEffect(() => {
        const handleVisibilityChange = () => {
            const visible = document.visibilityState === 'visible';
            setIsPageVisible(visible);
            if (visible) setAnnouncementNow(Date.now() + serverTimeOffsetRef.current);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (!isPageVisible) return undefined;
        const timer = window.setInterval(() => setAnnouncementNow(Date.now() + serverTimeOffsetRef.current), 30_000);
        return () => window.clearInterval(timer);
    }, [isPageVisible]);

    useEffect(() => {
        if (!currentUser) return;
        setSettingsTab(currentUser.role === 'super_admin' ? 'api' : 'users');
    }, [currentUser]);

    const ADMIN_TABS = isAdmin ? [
        { id: 'api', label: 'API 设置', icon: Sparkles },
        { id: 'sso', label: '免密登录配置', icon: Key },
        { id: 'email', label: '邮件服务', icon: Mail },
        { id: 'users', label: '用户管理', icon: Users },
        { id: 'announcements', label: '系统公告', icon: Megaphone },
        { id: 'gifts', label: '赠送礼物', icon: Gift },
        { id: 'content', label: '全局文案', icon: Type },
        { id: 'appearance', label: '界面外观', icon: Palette },
        { id: 'database', label: '数据库配置', icon: Database },
        { id: 'account-api', label: '账号管理 API', icon: Network }
    ] : [{ id: 'users', label: '用户管理', icon: Users }];

    // Effects
    useEffect(() => {
        if (currentUser && token) {
            const updateDeviceInfo = async () => {
                const deviceInfo = { userAgent: navigator.userAgent, screenResolution: `${window.screen.width}x${window.screen.height}` };
                try { await api.patch(`/users/${currentUser.id}/device`, deviceInfo, { retry: 0, fallback: '设备信息上报失败' }); } catch (e) { notify(e.message || '设备信息上报失败', 'warning'); }
            };
            updateDeviceInfo();
        }
    }, [currentUser, token]);

    // 壁纸预加载与主题色提取共用同一个 Image 实例（一次下载、一次解码），
    // 详见下方 wallpaperCandidateUrl 变化时的 useEffect。

    // 手动色调仅作用于主色调模式；所有已选壁纸均使用图片提取色。
    useEffect(() => {
        setActiveThemeColor(
            uiThemeSettings.effectMode === 'color'
                ? (uiThemeSettings.manualColor || 'blue')
                : (
                    uiThemeSettings.effectMode === 'wallpaper'
                    && ['bing', 'wallpaper'].includes(uiThemeSettings.backgroundMode)
                    && wallpaperAccent?.themeKey
                        ? wallpaperAccent.themeKey
                        : 'blue'
                )
        );
    }, [
        uiThemeSettings.effectMode,
        uiThemeSettings.backgroundMode,
        uiThemeSettings.manualColor,
        wallpaperAccent?.themeKey
    ]);

    const fetchUsers = useCallback(async ({ signal, page = usersPage, search = debouncedUsersSearch } = {}) => {
        if (!token) return;
        const requestId = ++usersRequestIdRef.current;
        setUsersLoading(true);
        setUsersLoadError('');
        try {
            const query = new URLSearchParams({ page: String(page), pageSize: String(usersPageSize) });
            if (search.trim()) query.set('search', search.trim());
            const data = await api.get(`/users?${query.toString()}`, {
                fallback: '用户列表读取失败',
                signal,
                retry: 0
            });
            if (requestId !== usersRequestIdRef.current) return;
            const list = Array.isArray(data) ? data : (data.users || []);
            setUsers(list);
            setUsersTotal(Array.isArray(data) ? list.length : Number(data.total) || list.length);
            setPermissions(Object.fromEntries(list.map(user => [user.id, user.permissions || []])));
            setUserTimeRules(Object.fromEntries(list.map(user => [user.id, user.timeRules || {}])));
            if (list.length === 0 && page > 1) setUsersPage(page - 1);
        } catch (e) {
            if (e.name !== 'AbortError' && requestId === usersRequestIdRef.current) {
                setUsersLoadError(e.message || '用户列表读取失败，请重试');
            }
        } finally {
            if (requestId === usersRequestIdRef.current) setUsersLoading(false);
        }
    }, [debouncedUsersSearch, token, usersPage, usersPageSize]);
    const fetchClasses = useCallback(async () => {
        if (!token) return;
        try {
            const rows = await api.get('/users/classes', { fallback: '班级列表读取失败' });
            if (Array.isArray(rows)) setClassOptions(rows);
        } catch { /* 保留从用户列表派生的回退数据 */ }
    }, [token]);
    const searchUsersForGift = useCallback(async (keyword) => {
        const query = new URLSearchParams({ search: String(keyword || '').trim(), pageSize: '50', page: '1' });
        const data = await api.get(`/users?${query.toString()}`, { fallback: '用户搜索失败', retry: 0 });
        return Array.isArray(data) ? data : (data.users || []);
    }, []);
    const fetchSsoConfigs = useCallback(async () => {
        if (!token) return;
        setSsoConfigsLoadError('');
        try {
            setSsoConfigs(await api.get('/sso-config', { fallback: 'SSO 配置读取失败' }));
        } catch (e) {
            setSsoConfigsLoadError(e.message || 'SSO 配置读取失败，请重试');
        }
    }, [token]);
    const fetchSharedContent = useCallback(async () => {
        if (!token) return;
        if (contentRequestRef.current) return contentRequestRef.current;
        const requestToken = token;
        const request = (async () => {
            try {
                const revisions = contentRevisionRef.current;
                const query = new URLSearchParams({
                    announcementRevision: revisions.announcements || '',
                    giftRevision: revisions.gifts || ''
                });
                const data = await api.get(`/content/updates?${query.toString()}`, { fallback: '公告和礼物读取失败' });
                if (localStorage.getItem('authToken') !== requestToken) return false;
                if (data.announcements?.changed) setAnnouncements(Array.isArray(data.announcements.items) ? data.announcements.items : []);
                if (data.gifts?.changed) setGifts(Array.isArray(data.gifts.items) ? data.gifts.items : []);
                contentRevisionRef.current = {
                    announcements: String(data.announcements?.revision ?? revisions.announcements ?? ''),
                    gifts: String(data.gifts?.revision ?? revisions.gifts ?? '')
                };
                const serverTime = Date.parse(data.serverTime);
                if (Number.isFinite(serverTime)) {
                    serverTimeOffsetRef.current = serverTime - Date.now();
                    setAnnouncementNow(serverTime);
                }
                setContentLoadError('');
                return true;
            } catch (e) {
                setContentLoadError(e.message || '公告和礼物读取失败，请重试');
                return false;
            } finally {
                contentRequestRef.current = null;
            }
        })();
        contentRequestRef.current = request;
        return request;
    }, [token]);

    const fetchAiConfig = useCallback(async () => {
        if (!token) return;
        try {
            const serverConfig = await api.get('/ai/config', { fallback: 'AI 配置读取失败' });
            setAiConfig({ ...DEFAULT_AI_CONFIG, ...serverConfig });
        } catch (e) { notify(e.message || 'AI 配置读取失败', 'warning'); }
    }, [token]);

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

    useEffect(() => {
        if (currentUser) fetchSsoConfigs();
    }, [currentUser, fetchSsoConfigs]);

    useEffect(() => {
        setContentLoadError('');
        contentRevisionRef.current = { announcements: '', gifts: '' };
        fetchSiteConfig();
        if (token && currentUser) {
            fetchLinks({ animate: true });
            fetchStudentAccounts();
            fetchAiConfig();
        } else {
            resetCompetitionCatalog();
            setAnnouncements([]);
            setGifts([]);
        }
    }, [currentUser, fetchAiConfig, fetchLinks, fetchSiteConfig, fetchStudentAccounts, resetCompetitionCatalog, token]);

    useEffect(() => {
        setPasswordReminderDismissed(false);
    }, [currentUser?.id]);
    useEffect(() => {
        if (!token || !currentUser || !isPageVisible) return undefined;
        let cancelled = false;
        let timer = null;
        const poll = async () => {
            const succeeded = await fetchSharedContent();
            if (cancelled) return;
            const baseDelay = succeeded === false ? 60_000 : 30_000;
            const jitter = Math.floor(Math.random() * 5_000);
            timer = window.setTimeout(poll, baseDelay + jitter);
        };
        poll();
        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
        };
    }, [currentUser, fetchSharedContent, isPageVisible, token]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedUsersSearch(usersSearch.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [usersSearch]);

    useEffect(() => {
        if (!token || !canManageUsers || activePage !== 'settings') return;
        const controller = new AbortController();
        switch (settingsTab) {
            case 'users':
            case 'gifts':
                fetchUsers({ signal: controller.signal });
                break;
            case 'sso': fetchSsoConfigs(); break;
            default: break;
        }
        if (settingsTab === 'users') fetchClasses();
        return () => controller.abort();
    }, [activePage, canManageUsers, debouncedUsersSearch, fetchClasses, fetchSsoConfigs, fetchUsers, settingsTab, token, usersPage]);

    useEffect(() => {
        if (currentUser && !isAdmin) {
            const gift = gifts.find(g => !g.read && g.targetUserId === currentUser.id);
            if (gift) {
                if (!activeGift || activeGift.id !== gift.id) {
                    setActiveGift(gift);
                    if (!activeGift) setIsGiftMinimized(false);
                }
            } else {
                setActiveGift(null);
            }
        }
    }, [gifts, currentUser, isAdmin, activeGift]);

    const sentGiftsWithUser = useMemo(() => {
        if (!isAdmin) return [];
        return gifts.map(gift => {
            const recipient = users.find(u => u.id === gift.targetUserId);
            return { ...gift, recipientName: gift.recipientName || (recipient ? recipient.username : '未知用户') };
        }).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    }, [gifts, users, isAdmin]);

    const availableClasses = useMemo(() => {
        if (classOptions.length) return classOptions;
        return users
            .filter(user => user.role === 'teacher' && user.class_id)
            .map(user => ({ id: user.class_id, name: user.class_name || user.username, teacherUsername: user.username }));
    }, [users, classOptions]);

    const filteredLinks = useMemo(() => {
        // 如果 links 不是数组，返回空数组防止报错
        if (!Array.isArray(links)) return [];

        const base = links;
        const keyword = String(searchTerm || '').trim().toLocaleLowerCase('zh-CN');
        if (!keyword) return base;
        return base.filter(link => {
            const title = String(link.title || '').toLocaleLowerCase('zh-CN');
            const category = String(link.category || '未分类').toLocaleLowerCase('zh-CN');
            return title.includes(keyword) || category.includes(keyword);
        });
    }, [links, searchTerm]);

    const competitionLinks = useMemo(() => filteredLinks.filter(link => link.ssoMethod !== 'paasV2'), [filteredLinks]);
    const agentLinks = useMemo(() => filteredLinks.filter(link => link.ssoMethod === 'paasV2'), [filteredLinks]);

    const groupedLinks = useMemo(() => {
        const groups = {};
        competitionLinks.forEach(link => {
            const cat = link.category || '未分类';
            if (!groups[cat]) groups[cat] = { title: cat, items: [] };
            groups[cat].items.push(link);
        });
        return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }, [competitionLinks]);

    const showCategoryArrange = links.length > 1;
    const toggleCategoryArrange = useCallback(() => {
        const updateLayout = () => setCategoryArrangeEnabled(enabled => !enabled);
        if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
            updateLayout();
            return;
        }

        categoryTransitionRef.current?.skipTransition?.();
        const transition = document.startViewTransition(() => {
            // The browser must see the old and new card rectangles in the same
            // transition frame so cards can glide across re-parented rows.
            flushSync(updateLayout);
        });
        categoryTransitionRef.current = transition;
        const clearTransition = () => {
            if (categoryTransitionRef.current === transition) categoryTransitionRef.current = null;
        };
        transition.finished.then(clearTransition, clearTransition);
    }, []);
    const visibleLinkGroups = useMemo(() => {
        if (categoryArrangeEnabled) return groupedLinks;
        return competitionLinks.length
            ? [['all', { title: '', items: competitionLinks }]]
            : [];
    }, [categoryArrangeEnabled, competitionLinks, groupedLinks]);

    const agentPlatformGroups = useMemo(() => {
        void platformOverrideTick;
        const builtinMeta = readBuiltinPlatformOverrides();
        const customMeta = readCustomPlatformsMeta();
        const groups = {};
        agentLinks.forEach(link => {
            const key = link.paasV2SoftwareUnique || link.softwareUnique || 'PT04';
            if (!groups[key]) {
                const meta = builtinMeta[key] || customMeta[key];
                let code;
                let name;
                if (meta && (meta.code || meta.name)) {
                    code = meta.code || key;
                    name = meta.name || (AGENT_PLATFORM_LABELS[key] ? AGENT_PLATFORM_LABELS[key].split(' · ')[1] : (link.category || key));
                } else if (AGENT_PLATFORM_LABELS[key]) {
                    const [labelCode, labelName] = AGENT_PLATFORM_LABELS[key].split(' · ');
                    code = labelCode;
                    name = labelName;
                } else {
                    code = key;
                    name = link.category || key;
                }
                groups[key] = { key, label: `${code} · ${name}`, items: [] };
            }
            groups[key].items.push(link);
        });
        return Object.entries(groups);
    }, [agentLinks, platformOverrideTick]);
    const competitionFieldHistory = useMemo(() => ({
        categories: [...new Set(links.map(link => String(link.category || '').trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'zh-CN')),
        titles: [...new Set(links.map(link => String(link.title || '').trim()).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    }), [links]);

    // Mutations and event handlers
    const handleSave = async (data) => {
        if (!token) return notify('请先登录', 'warning');
        try {
            if (editingLink) await api.put(`/competitions/${editingLink.id}`, data, { fallback: '保存失败' });
            else await api.post('/competitions', data, { fallback: '保存失败' });
            setIsModalOpen(false); setEditingLink(null); await fetchLinks();
        } catch (e) { notify(e.message, 'error'); }
    };
    const handleResetAgentTask = async (link) => {
        if (!token) return notify('请先登录', 'warning');
        if (!await confirmAction({
            title: '重置智能体任务',
            message: '确定要重置该任务在大渔平台的数据吗？',
            confirmText: '重置'
        })) return;
        try {
            await api.post('/paas-v2/reset', { competitionId: link.id }, { fallback: '重置任务失败' });
            await fetchLinks({ animate: false });
            notify('重置任务已提交', 'success');
        } catch (error) {
            notify(error.message || '重置任务失败', 'error');
        }
    };

    const handleDelete = async (id) => {
        if (!token || !await confirmAction({
            title: '删除竞赛卡片',
            message: '删除后无法恢复，确定继续吗？',
            confirmText: '删除'
        })) return;
        try {
            await api.delete(`/competitions/${id}`, { fallback: '删除失败' });
            await fetchLinks();
        } catch (e) { notify(e.message, 'error'); }
    };

    const handleDeleteAgentPlatform = async (group) => {
        if (!token) return notify('请先登录', 'warning');
        const ids = (group?.items || []).map(link => link.id).filter(Boolean);
        if (!ids.length) return;
        if (!await confirmAction({
            title: '删除智能体模块',
            message: `确定要删除「${group.label}」下的 ${ids.length} 个智能体任务吗？删除后无法恢复。`,
            confirmText: '删除模块'
        })) return;
        try {
            await api.post('/competitions/batch-delete', { ids }, { fallback: '删除失败', timeoutMs: 60_000, retry: 0 });
            await fetchLinks();
            notify(`已删除 ${ids.length} 个智能体任务`, 'success');
        } catch (error) {
            notify(error.message || '删除失败', 'error');
        }
    };

    const handleAdminAddUser = async (newUsers) => {
        try {
            const result = await api.post('/users/batch', { users: newUsers }, { fallback: '批量创建用户失败', timeoutMs: 60_000, retry: 0 });
            const createdUsers = result.users || [];
            for (let index = 0; index < newUsers.length; index += 1) {
                const input = newUsers[index];
                const created = createdUsers[index];
                if (created && created.id && Array.isArray(input.permissions)) {
                    await api.patch(`/users/${created.id}/permissions`, {
                        permissions: input.permissions,
                        timeRules: input.timeRules || {}
                    }, { fallback: '权限保存失败', timeoutMs: 60_000, retry: 0 });
                }
            }
            notify(`已成功创建 ${result.count ?? newUsers.length} 个账号`, 'success');
            await fetchUsers();
            setIsAddUserModalOpen(false);
        } catch (e) { notify(e.message, 'error'); }
    };
    const handleAdminDeleteUser = async (userIds) => {
        try {
            const result = await api.delete('/users/batch', {
                body: JSON.stringify({ userIds }),
                fallback: '批量删除用户失败',
                timeoutMs: 60_000,
                retry: 0
            });
            notify(`已删除 ${result.count ?? userIds.length} 个账号`, 'success');
            await fetchUsers();
            setIsDeleteUserModalOpen(false);
        } catch (e) { notify(e.message, 'error'); }
    };
    const toggleUserStatus = async (user) => {
        if (!token) return;
        try {
            await api.patch(`/users/${user.id}/status`, { is_disabled: !user.is_disabled }, { fallback: '状态更新失败' });
            await fetchUsers();
        } catch (e) { notify(e.message, 'error'); }
    };
    const handleChangeUserClass = async (user, classId) => {
        try {
            await api.patch(`/users/${user.id}/class`, { classId: Number(classId) }, { fallback: '班级调整失败' });
            await fetchUsers();
        } catch (e) { notify(e.message, 'error'); }
    };
    const handleSavePermissions = async (userId, selectedIds, timeRules) => {
        try {
            await api.patch(`/users/${userId}/permissions`, { permissions: selectedIds, timeRules }, { fallback: '权限保存失败' });
            setPermissions(prev => ({ ...prev, [userId]: selectedIds }));
            setUserTimeRules(prev => ({ ...prev, [userId]: timeRules }));
            setIsPermissionModalOpen(false); setTargetUserForPermission(null); notify('权限已更新', 'success');
            await fetchUsers();
        } catch (e) { notify(e.message, 'error'); }
    };

    const saveAiConfig = async (newConfig) => {
        const configToSave = newConfig || aiConfig;
        try {
            const data = await api.put('/ai/config', configToSave, { fallback: 'AI 配置保存失败', timeoutMs: 15_000, retry: 0 });
            setAiConfig({ ...DEFAULT_AI_CONFIG, ...data.config });
            return { success: true, config: data.config };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const testAiConfig = async (configToTest) => {
        try {
            const data = await api.post('/ai/test', configToTest || aiConfig, { fallback: 'AI 连接测试失败', timeoutMs: 55_000, retry: 0 });
            return { success: true, ...data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const discoverAiModels = async (configToDiscover) => {
        try {
            const data = await api.post('/ai/models/discover', configToDiscover || aiConfig, {
                fallback: '上游模型识别失败', timeoutMs: 20_000, retry: 0
            });
            return { success: true, ...data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const handleUpdateAnnouncements = async (newList) => {
        try {
            const result = await api.put('/content/announcements', newList, { fallback: '公告保存失败' });
            setAnnouncements(newList);
            if (result.revision !== undefined) contentRevisionRef.current.announcements = String(result.revision);
            return true;
        } catch (e) { notify(e.message, 'error'); return false; }
    };

    const handleSendGift = async () => {
        if (!giftForm.title || !giftForm.targetUsers.length) return notify('请完善礼物信息', 'warning');
        const newGifts = giftForm.targetUsers.map(uid => ({
            id: Date.now() + Math.random(),
            targetUserId: uid,
            ...giftForm,
            sentAt: new Date().toISOString(),
            read: false
        }));
        try {
            const result = await api.post('/content/gifts', newGifts, { fallback: '礼物发送失败' });
            const list = [...gifts, ...newGifts];
            setGifts(list);
            if (result.revision !== undefined) contentRevisionRef.current.gifts = String(result.revision);
            setGiftForm({ title: '', content: '', type: 'link', targetUsers: [] });
            notify('发送成功', 'success');
        } catch (e) { notify(e.message, 'error'); }
    };

    const handleUpdateGift = async (giftId, data) => {
        try {
            const result = await api.put(`/content/gifts/${giftId}`, data, { fallback: '礼物更新失败' });
            const list = gifts.map(g => g.id === giftId ? { ...g, ...data } : g);
            if (result.revision !== undefined) contentRevisionRef.current.gifts = String(result.revision);
            setGifts(list); setIsEditGiftModalOpen(false);
        } catch (e) { notify(e.message, 'error'); }
    };
    const handleDeleteGift = async (giftId) => {
        if (!await confirmAction({
            title: '撤回礼物',
            message: '确定撤回这份礼物吗？',
            confirmText: '撤回'
        })) return;
        try {
            const result = await api.delete(`/content/gifts/${giftId}`, { fallback: '礼物撤回失败' });
            const list = gifts.filter(g => g.id !== giftId); setGifts(list);
            if (result.revision !== undefined) contentRevisionRef.current.gifts = String(result.revision);
        } catch (e) { notify(e.message, 'error'); }
    };
    const markGiftAsRead = async (giftId) => {
        try {
            const result = await api.patch(`/content/gifts/${giftId}/read`, {}, { fallback: '状态更新失败' });
            const list = gifts.map(g => g.id === giftId ? { ...g, read: true } : g);
            if (result.revision !== undefined) contentRevisionRef.current.gifts = String(result.revision);
            setGifts(list);
            setActiveGift(null); setIsGiftMinimized(false);
        } catch (e) { notify(e.message, 'error'); }
    };

    const paletteTheme = THEMES[activeThemeColor] || THEMES.blue;
    const currentTheme = (
        effectMode === 'wallpaper'
        && ['bing', 'wallpaper'].includes(uiThemeSettings.backgroundMode)
        && wallpaperAccent?.rgb
    ) ? { ...paletteTheme, rgb: wallpaperAccent.rgb } : paletteTheme;
    const accentStyle = { '--system-accent-rgb': currentTheme.rgb || THEMES.blue.rgb };
    const backgroundLayers = (
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
            suspendImmersive={activePage === 'settings'}
            onWallpaperLoad={handleWallpaperLoad}
            onWallpaperError={handleWallpaperError}
        />
    );

    const dashboardAlignClass = {
        left: 'text-left items-start',
        center: 'text-center items-center',
        right: 'text-right items-end'
    }[siteConfig.dashboardTextAlign || 'left'];

    const getFooterSizeClass = () => ({
        small: 'text-[10px] md:text-xs',
        medium: 'text-xs md:text-sm',
        large: 'text-sm md:text-base'
    }[siteConfig.footerSize || 'small']);

    const shouldShowFooter = (page) => {
        const visibility = siteConfig.footerVisibility || 'all';
        if (visibility === 'none') return false;
        if (visibility === 'all') return true;
        if (visibility === 'login_only' && page === 'login') return true;
        if (visibility === 'dashboard_only' && page === 'dashboard') return true;
        return false;
    };

    // Render
    if (authStatus === 'checking') {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative`} style={accentStyle}>
                {backgroundLayers}
                <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
                    <div role="status" aria-live="polite" className={`${GLASS_CARD} flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-bold text-slate-600 shadow-xl dark:text-slate-200`}>
                        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                        正在验证登录状态…
                    </div>
                </div>
            </div>
        );
    }

    if (!currentUser) {
        return (
            <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative ${
                systemEffects.loginEntrance === false ? 'system-effects-no-login-entrance' : ''
            } ${effectMode === 'default' ? 'system-background-default' : ''}`} style={accentStyle}>

                <FeedbackCenter />
                <div className="fixed left-1/2 top-4 z-[200] w-[min(92vw,560px)] -translate-x-1/2">
                    <LoadErrorNotice message={siteConfigLoadError} onRetry={fetchSiteConfig} />
                </div>
                {backgroundLayers}

                <div className="relative z-10 min-h-screen flex flex-col">
                    <div className="flex-grow flex items-center justify-center">
                        <LoginPage
                            onLogin={(user, authToken) => handleLoginSuccess(user, authToken, {
                                animate: systemEffects.loginEntrance !== false
                            })}
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

    return (
        <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative ${
            systemEffects.dashboardCardReveal === false ? 'system-effects-no-card-reveal' : ''
        }`} style={accentStyle}>

            <FeedbackCenter />
            {currentUser.passwordChangeRecommended && !passwordReminderDismissed && (
                <PasswordChangeReminder
                    username={currentUser.username}
                    onDismiss={() => setPasswordReminderDismissed(true)}
                    onComplete={async () => {
                        try {
                            await refreshCurrentUser();
                            notify('密码已更新', 'success');
                        } catch (error) {
                            notify(error.message || '用户状态刷新失败，请重新登录', 'error');
                            handleLogout();
                        }
                    }}
                />
            )}
            <div className="fixed left-1/2 top-4 z-[200] w-[min(92vw,560px)] -translate-x-1/2">
                <LoadErrorNotice message={siteConfigLoadError} onRetry={fetchSiteConfig} />
            </div>
            {backgroundLayers}

            <div className="relative z-10 min-h-screen flex flex-col">
                <Navbar
                    isAdmin={isAdmin} canManageUsers={canManageUsers} user={currentUser} onLogout={handleLogout}
                    activePage={activePage} setActivePage={setActivePage}
                    siteConfig={siteConfig} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
                    onAdd={() => { setEditingLink(null); setIsModalOpen(true); }}
                    onAddTaskApp={() => { setEditingLink(null); setTaskAppSoftwareUnique(''); setIsTaskAppModalOpen(true); }}
                    immersiveMode={activeImmersive}
                    isCardEditMode={isCardEditMode}
                    setIsCardEditMode={setIsCardEditMode}
                    hasActiveAnnouncement={!!activeAnnouncement}
                    isAnnouncementVisible={isAnnouncementVisible}
                    onToggleAnnouncement={() => setIsAnnouncementVisible(!isAnnouncementVisible)}
                    showCategoryArrange={showCategoryArrange}
                    categoryArrangeEnabled={categoryArrangeEnabled}
                    onToggleCategoryArrange={toggleCategoryArrange}
                    enteringFromLogin={isNavbarTransitioning}
                    onEntryTransitionEnd={completeNavbarTransition}
                    activeThemeColor={activeThemeColor}
                />

                <div className="flex-grow">
                    {activePage === 'settings' && canManageUsers ? (
                        <div className="settings-shell min-w-0 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-28 w-full flex flex-col md:flex-row gap-4 md:gap-6 relative z-10">
                            <aside className="settings-surface w-full md:w-56 rounded-2xl p-3 md:p-4 flex-shrink-0 h-fit overflow-hidden">
                                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-2">系统管理</h2>
                                <nav className="relative flex flex-row overflow-x-auto pb-1 md:pb-0 md:overflow-visible md:flex-col gap-1 text-sm">
                                    <div
                                        className={`hidden md:block absolute left-0 rounded-xl transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] shadow-lg ${
                                            THEMES[activeThemeColor]?.shadow || 'shadow-slate-900/20'
                                        } bg-gradient-to-r ${
                                            THEMES[activeThemeColor]?.gradient || 'from-slate-800 to-slate-900'
                                        }`}
                                        style={{
                                            height: '44px',
                                            width: '100%',
                                            top: `${ADMIN_TABS.findIndex(t => t.id === settingsTab) * 48}px`,
                                            opacity: 1,
                                            zIndex: 0
                                        }}
                                    />
                                    {ADMIN_TABS.map(tab => {
                                        const isActive = settingsTab === tab.id;
                                        return (
                                            <button key={tab.id} onClick={() => setSettingsTab(tab.id)} className={`relative z-10 min-w-max md:min-w-0 px-4 py-3 rounded-xl font-bold flex items-center gap-3 md:justify-between transition-colors duration-300 ${isActive ? `settings-nav-active bg-gradient-to-r ${THEMES[activeThemeColor]?.gradient || 'from-slate-800 to-slate-900'} text-white md:bg-none` : 'text-slate-600 hover:bg-slate-50/50'}`}>
                                                <span>{tab.label}</span><tab.icon className="w-4 h-4" />
                                            </button>
                                        );
                                    })}
                                </nav>
                            </aside>

                            <section className="settings-surface min-w-0 flex-1 overflow-hidden rounded-3xl p-4 sm:p-8 min-h-[600px]">
                                <Suspense fallback={(
                                    <div className="flex min-h-[420px] items-center justify-center">
                                        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                                    </div>
                                )}>
                                {settingsTab === 'api' && <ApiEngine aiConfig={aiConfig} setAiConfig={setAiConfig} onSave={saveAiConfig} onTest={testAiConfig} onDiscoverModels={discoverAiModels} />}
                                {settingsTab === 'sso' && <SsoManager configs={ssoConfigs} token={token} fetchConfigs={fetchSsoConfigs} loadError={ssoConfigsLoadError} onRetry={fetchSsoConfigs} />}
                                {settingsTab === 'email' && <EmailServiceManager />}
                                {settingsTab === 'users' && (
                                    <UserManager
                                        users={users}
                                        currentUser={currentUser}
                                        classes={availableClasses}
                                        page={usersPage}
                                        total={usersTotal}
                                        pageSize={usersPageSize}
                                        searchTerm={usersSearch}
                                        onSearchChange={(value) => {
                                            setUsersSearch(value);
                                            setUsersPage(1);
                                        }}
                                        onPageChange={(nextPage) => setUsersPage(Math.max(1, nextPage))}
                                        onAdd={() => setIsAddUserModalOpen(true)}
                                        onDelete={() => setIsDeleteUserModalOpen(true)}
                                        onRefresh={() => {
                                            fetchUsers();
                                            fetchLinks();
                                            fetchStudentAccounts();
                                        }}
                                        onToggleStatus={toggleUserStatus}
                                        onClassChange={handleChangeUserClass}
                                        onPermission={(u) => { setTargetUserForPermission(u); setIsPermissionModalOpen(true); }}
                                        loading={usersLoading}
                                        loadError={usersLoadError}
                                        onRetry={fetchUsers}
                                    />
                                )}
                                {settingsTab === 'announcements' && (
                                    <AnnouncementManager
                                        announcements={announcements}
                                        onUpdate={handleUpdateAnnouncements}
                                        loadError={contentLoadError}
                                        onRetry={fetchSharedContent}
                                    />
                                )}
                                {settingsTab === 'gifts' && <GiftManager giftForm={giftForm} setGiftForm={setGiftForm} onSend={handleSendGift} sentGifts={sentGiftsWithUser} onEdit={(g) => { setEditingGift(g); setIsEditGiftModalOpen(true); }} onDelete={handleDeleteGift} users={users} onSearchUsers={searchUsersForGift} loadError={contentLoadError} onRetry={fetchSharedContent} />}
                                {settingsTab === 'content' && <ContentManager config={siteConfig} onSave={persistSiteConfig} />}
                                {settingsTab === 'appearance' && <AppearanceManager settings={uiThemeSettings} effectiveLightDark={effectiveLightDark} onSave={saveUiThemeSettings} token={token} />}
                                {settingsTab === 'database' && <DatabaseManager token={token} />}
                                {settingsTab === 'account-api' && <AccountManagementApiManager token={token} />}
                                </Suspense>
                            </section>
                        </div>
                    ) : (
                        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-28 w-full relative z-10">

                            <AnnouncementBanner
                                announcement={activeAnnouncement}
                                isVisible={isAnnouncementVisible}
                                isClosing={isAnnouncementClosing}
                                onClose={triggerCloseAnnouncement}
                                themeSettings={uiThemeSettings}
                            />

                            <header className={`mb-8 relative flex flex-col ${dashboardAlignClass}`}>
                                <LoadErrorNotice message={contentLoadError || studentAccountsLoadError} onRetry={() => { fetchSharedContent(); fetchStudentAccounts(); }} compact />
                                {siteConfig.dailyQuote && (
                                    <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-indigo-50/50 border border-indigo-100/50 backdrop-blur-sm w-fit animate-in fade-in slide-in-from-top-2">
                                        <Quote className="w-3 h-3 text-indigo-500 fill-indigo-500" />
                                        <span className="text-xs font-bold text-indigo-600/90">{siteConfig.dailyQuote}</span>
                                    </div>
                                )}
                                <h1 className={`font-black text-slate-900 dark:text-white text-4xl ${INK_TEXT_SHADOW}`}>
                                    {(siteConfig.welcomeTitle || "Hello, {username} 👋").replace('{username}', currentUser?.username || 'User')}
                                </h1>
                                {siteConfig.welcomeSubtitle && (
                                    <p className="mt-2 text-slate-500 dark:text-slate-400 font-medium">
                                        {siteConfig.welcomeSubtitle}
                                    </p>
                                )}
                            </header>
                            <div className="relative grid min-h-[360px] pb-20">
                                {(linksPhase === 'loading' || linksPhase === 'revealing') && (
                                    <div className={`competition-loader-layer col-start-1 row-start-1 flex min-h-[360px] flex-col items-center justify-center px-6 text-center ${linksPhase === 'revealing' ? 'competition-loader-layer-exit' : ''}`}>
                                        <div className="competition-loader-orb flex h-16 w-16 items-center justify-center rounded-2xl bg-white/80 text-indigo-600 shadow-lg shadow-indigo-200/40 dark:bg-slate-800 dark:text-indigo-300">
                                            <Loader2 className="h-8 w-8 animate-spin" />
                                        </div>
                                        <h2 className="mt-5 text-lg font-black text-slate-800 dark:text-white">正在加载竞赛卡片</h2>
                                        <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">正在从云端同步最新内容，请稍候…</p>
                                    </div>
                                )}
                                {linksPhase === 'error' ? (
                                    <div className="col-start-1 row-start-1 flex min-h-[320px] flex-col items-center justify-center rounded-[2rem] border border-red-100 bg-white/50 px-6 text-center shadow-sm backdrop-blur-sm dark:border-red-900/50 dark:bg-slate-900/40">
                                        <AlertTriangle className="h-9 w-9 text-red-500" />
                                        <h2 className="mt-4 text-lg font-black text-slate-800 dark:text-white">竞赛卡片加载失败</h2>
                                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{linksLoadError}</p>
                                        <button type="button" onClick={() => fetchLinks({ animate: true })} className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-xs font-black text-white shadow-lg shadow-indigo-200/50"><RefreshCw className="h-4 w-4" />重新加载</button>
                                    </div>
                                ) : linksPhase !== 'loading' && (
                                    <div
                                        className={`col-start-1 row-start-1 competition-flow-grid ${categoryArrangeEnabled ? 'competition-flow-grid--categorized' : 'competition-flow-grid--flat'} ${linksPhase === 'revealing' ? 'competition-content-reveal' : ''}`}
                                        onAnimationEnd={(event) => {
                                            if (event.target === event.currentTarget && event.animationName === 'competition-content-reveal') completeLinksReveal();
                                        }}
                                    >
                                        {visibleLinkGroups.length === 0 ? (
                                            <div className="flex min-h-[300px] items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white/30 text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/30">暂无可显示的竞赛卡片</div>
                                        ) : visibleLinkGroups.map(([category, group], sectionIndex) => (
                                            <section key={category} className={linksPhase === 'revealing' ? 'competition-section-reveal' : ''} style={linksPhase === 'revealing' ? { animationDelay: `${Math.min(sectionIndex * 90, 270)}ms` } : undefined}>
                                                <div className="competition-flow-items grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                                    {group.items.map((link, cardIndex) => (
                                                        <div
                                                            key={link.id}
                                                            className={`competition-flow-card ${linksPhase === 'revealing' ? 'competition-card-reveal' : ''}`}
                                                            style={{
                                                                viewTransitionName: `competition-card-${link.id}`,
                                                                ...(linksPhase === 'revealing'
                                                                    ? { animationDelay: `${Math.min(100 + sectionIndex * 90 + cardIndex * 65, 520)}ms` }
                                                                    : {})
                                                            }}
                                                        >
                                                            <div className="competition-card-category" title={link.category || '未分类'}>
                                                                <span>{link.category || '未分类'}</span>
                                                            </div>
                                                            <ContestCard
                                                                    link={link} isAdmin={isAdmin} userRole={currentUser?.role} overrideTime={link._overrideTime}
                                                                    onEdit={(l)=>{setEditingLink(l); setIsModalOpen(true);}}
                                                                    onDelete={handleDelete}
                                                                    onAiGuide={(l)=>{setCurrentAiLink(l); setIsAiModalOpen(true);}}
                                                                    onOpen={handleOpenCompetition}
                                                                    studentAccounts={studentAccountsByCard[String(link.id)] || []}
                                                                    expertTargets={studentAccountsByCard[String(link.id)] || []}
                                                                    onCreateStudent={handleCreateStudent}
                                                                    isCreatingStudent={String(creatingStudentCardId) === String(link.id)}
                                                                    onDeleteStudent={handleDeleteStudent}
                                                                    deletingStudentKey={deletingStudentKey}
                                                                    openingCompetitionKeys={openingCompetitionKeys}
                                                                    createPanel={createPanel} setCreatePanel={setCreatePanel}
                                                                    onRequestManualCredential={handleRequestManualCredential}
                                                                    onOpenAdminEntry={handleOpenAdminEntry}
                                                                    immersiveMode={activeImmersive}
                                                                    isCardEditMode={isCardEditMode}
                                                                    categoryArrangeEnabled={categoryArrangeEnabled}
                                                                    aiGuideAvailable={Boolean(aiConfig.hasApiKey && aiConfig.apiUrl && aiConfig.modelName)}
                                                                    onDeleteClass={handleDeleteClass}
                                                                    onInitializeClass={handleInitializeClass}
                                                                    onRepairAccountReadiness={handleRepairAccountReadiness}
                                                                    onRestoreClass={handleRestoreClass}
                                                                    onUnsupportedClassDelete={handleUnsupportedClassDelete}
                                                                    classActionKey={classActionKey}
                                                                />
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}

                                {agentPlatformGroups.length > 0 && (
                                    <div className="agent-task-modules mt-8 space-y-6">
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-lg font-black text-slate-800 dark:text-white">智能体任务</h2>
                                            <span className="rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">{agentLinks.length} 个任务</span>
                                        </div>
                                        {agentPlatformGroups.map(([key, group]) => (
                                            <section key={key} className={`agent-task-module overflow-hidden rounded-[28px] border border-white/70 bg-white/55 pt-5 px-5 ${group.items.length > 8 ? 'pb-0' : 'pb-5'} shadow-[0_18px_50px_rgba(80,70,229,0.10)] backdrop-blur-xl dark:border-violet-900/50 dark:bg-slate-900/55`}>
                                                <div className="mb-4 flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"><Sparkles className="h-4 w-4" /></span>
                                                        <div><h3 className="text-sm font-black text-slate-900 dark:text-white">{group.label}</h3><p className="text-[10px] font-bold text-slate-400">{group.items.length} 个智能体任务</p></div>
                                                    </div>
                                                    {isAdmin && isCardEditMode && (
                                                        <div className="flex shrink-0 items-center gap-1.5">
                                                            <button type="button" onClick={() => { setEditingLink(null); setTaskAppSoftwareUnique(group.key); setIsTaskAppModalOpen(true); }} className="flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white/90 px-2.5 text-[10px] font-bold text-slate-600 shadow-sm hover:bg-slate-50"><Edit2 className="h-3 w-3" />编辑模块</button>
                                                            <button type="button" onClick={() => handleDeleteAgentPlatform(group)} className="flex h-8 items-center gap-1 rounded-xl border border-red-200 bg-white/90 px-2.5 text-[10px] font-bold text-red-500 shadow-sm hover:bg-red-50"><Trash2 className="h-3 w-3" />删除模块</button>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${group.items.length > 8 ? 'agent-task-scroll' : ''}`}>
                                                    {group.items.map(link => (
                                                        <AgentTaskCard
                                                            key={link.id}
                                                            link={link}
                                                            isAdmin={isAdmin}
                                                            onEdit={(l)=>{setEditingLink(l); setIsTaskAppModalOpen(true);}}
                                                            onDelete={handleDelete}
                                                            onOpen={handleOpenCompetition}
                                                            onReset={handleResetAgentTask}
                                                            openingCompetitionKeys={openingCompetitionKeys}
                                                            isCardEditMode={isCardEditMode}
                                                        />
                                                    ))}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </main>
                    )}
                </div>

                {shouldShowFooter('dashboard') && (
                    <footer className="py-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-1000 shrink-0">
                        <p className={`font-bold text-slate-400/80 dark:text-slate-600 ${getFooterSizeClass()}`}>
                            {siteConfig.footerText || "© 2025 Competition Hub. All rights reserved."}
                        </p>
                    </footer>
                )}

            </div>

            <Suspense fallback={null}>
                {isModalOpen && <EditModal isOpen onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingLink} existingCategories={competitionFieldHistory.categories} existingTitles={competitionFieldHistory.titles} ssoConfigs={ssoConfigs} authToken={token} />}
                {isTaskAppModalOpen && <TaskAppModal isOpen onClose={() => setIsTaskAppModalOpen(false)} onSave={async () => { setEditingLink(null); await fetchLinks(); }} onPlatformsChange={() => setPlatformOverrideTick(value => value + 1)} initialData={editingLink} initialSoftwareUnique={taskAppSoftwareUnique} ssoConfigs={ssoConfigs} existingLinks={links} />}
                {isAiModalOpen && <AiGuideModal isOpen onClose={() => setIsAiModalOpen(false)} link={currentAiLink} aiConfig={aiConfig} />}
                {isPermissionModalOpen && <PermissionModal isOpen onClose={() => setIsPermissionModalOpen(false)} user={targetUserForPermission} allLinks={links} currentPermissions={targetUserForPermission ? (permissions[targetUserForPermission.id] || []) : []} currentUserTimeRules={targetUserForPermission ? (userTimeRules[targetUserForPermission.id] || {}) : {}} onSave={handleSavePermissions} />}
                {activeGift && !isGiftMinimized && <GiftModal isOpen gift={activeGift} onClose={() => setIsGiftMinimized(true)} onOpenLink={markGiftAsRead} />}
            </Suspense>

            {/* Minimized gift shortcut */}
            {activeGift && isGiftMinimized && (
                <button
                    onClick={() => setIsGiftMinimized(false)}
                    className="fixed bottom-24 right-6 z-50 p-3 bg-white rounded-full shadow-2xl border-4 border-red-100 animate-bounce cursor-pointer hover:scale-110 transition-transform"
                    title="您有一份未拆开的礼物"
                >
                    <Gift className="w-6 h-6 text-red-500 fill-red-100" />
                    <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                </button>
            )}

            <Suspense fallback={null}>
                {isEditGiftModalOpen && <EditGiftModal isOpen onClose={() => setIsEditGiftModalOpen(false)} gift={editingGift} onSave={handleUpdateGift} />}
                {isAddUserModalOpen && (
                    <AddUserModal
                        isOpen
                        onClose={() => setIsAddUserModalOpen(false)}
                        onAdd={handleAdminAddUser}
                        currentUser={currentUser}
                        classes={availableClasses}
                        allLinks={links}
                    />
                )}
                {isDeleteUserModalOpen && <DeleteUserModal isOpen onClose={() => setIsDeleteUserModalOpen(false)} onDelete={handleAdminDeleteUser} users={users} currentUser={currentUser} />}
            </Suspense>
        </div>
    );
}
