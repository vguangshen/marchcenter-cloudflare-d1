import React, { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
    Sparkles, Network, Key, Users, Megaphone, Gift, Palette,
    RefreshCw, Quote,
    Database, Loader2, AlertTriangle, Mail, Edit2, Trash2
} from 'lucide-react';

// --- 组件引入 ---
import Navbar from './components/layouts/Navbar';
import AnnouncementBanner from './components/views/dashboard/AnnouncementBanner';
import AgentTaskGroups from './components/views/dashboard/AgentTaskGroups';
import FeedbackCenter from './components/feedback/FeedbackCenter';
import { api } from './utils/api';
import { confirmAction, notify } from './utils/uiFeedback';
import LoadErrorNotice from './components/feedback/LoadErrorNotice';
import ModalLoadingNotice from './components/feedback/ModalLoadingNotice';
import DeleteUserModal from './components/modals/DeleteUserModal';

// --- 配置 ---
import {
    DEFAULT_AI_CONFIG, DEFAULT_SITE_CONFIG, INK_TEXT_SHADOW
} from './constants/config';
import { THEMES } from './constants/themes';
import { IMMERSIVE_WALLPAPERS } from './constants/immersiveWallpapers';
import { prefersReducedMotion } from './utils/motionPreferences';
import { useCompetitionActions } from './hooks/useCompetitionActions';
import { useCompetitionCatalog } from './hooks/useCompetitionCatalog';
import { useAgentTaskResults } from './hooks/useAgentTaskResults';
import {
    DEFAULT_AGENT_PLATFORMS, normalizeAgentPlatforms, normalizePlatformKey,
    normalizeAgentPlatformTheme, agentPlatformThemeStyle, platformLabel,
    readLegacyAgentPlatforms, clearLegacyAgentPlatforms
} from './utils/paasV2Platforms';

// 后台、节日特效和大型弹窗仅在真正使用时下载，避免占用登录页首包。
const ApiEngine = lazy(() => import('./components/views/settings/ApiEngine'));
const SsoManager = lazy(() => import('./components/views/settings/SsoManager'));
const UserManager = lazy(() => import('./components/views/settings/UserManager'));
const GiftManager = lazy(() => import('./components/views/settings/GiftManager'));
const SiteSettings = lazy(() => import('./components/views/settings/SiteSettings'));
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
const ProfileModal = lazy(() => import('./components/modals/ProfileModal'));
const ContestCard = lazy(() => import('./components/cards/ContestCard'));
const AgentTaskCard = lazy(() => import('./components/cards/AgentTaskCard'));
const CardLoadingNotice = () => <div className="min-h-[190px] rounded-3xl border border-slate-200/60 bg-white/60 p-5 dark:border-slate-700 dark:bg-slate-900/60" role="status" aria-live="polite"><Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-slate-400" /><span className="sr-only">正在加载卡片…</span></div>;
export default function Dashboard({ auth, site, appearance }) {
    const {
        currentUser, token, authStatus, isNavbarTransitioning, completeNavbarTransition,
        refreshCurrentUser, updateCurrentUser, isAdmin, canManageUsers, handleLogout
    } = auth;
    const { siteConfig, siteConfigLoadError, fetchSiteConfig, persistSiteConfig } = site;
    const {
        isDarkMode, uiThemeSettings, effectiveLightDark, saveUiThemeSettings, activeThemeColor,
        activeImmersive, systemEffects, accentStyle, renderBackground
    } = appearance;

    const currentUserId = currentUser?.id;
    const currentUserRole = currentUser?.role;
    const handleProfileSaved = useCallback((savedUser) => {
        if (!token || localStorage.getItem('authToken') !== token) return null;
        if (savedUser) {
            if (String(savedUser.id) !== String(currentUserId)) return null;
            return updateCurrentUser(savedUser);
        }
        return refreshCurrentUser();
    }, [currentUserId, refreshCurrentUser, token, updateCurrentUser]);
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

    const {
        links, setLinks, linksPhase, linksLoadedForSession, linksLoadError,
        studentAccountsByCard, setStudentAccountsByCard, studentAccountsLoadError,
        fetchLinks, fetchStudentAccounts, completeLinksReveal, resetCompetitionCatalog
    } = useCompetitionCatalog({
        token,
        currentUser,
        revealEnabled: uiThemeSettings.systemEffects.dashboardCardReveal !== false
    });
    const refreshCompetitionBindings = useCallback(() => {
        if (token && localStorage.getItem('authToken') === token) return fetchLinks({ animate: false });
    }, [fetchLinks, token]);
    const {
        agentScoreStates, refreshAgentTaskScore, refreshReturnedAgentTask, trackAgentTaskReturn, handleResetAgentTask
    } = useAgentTaskResults({ token, userId: currentUserId, links, setLinks, fetchLinks });
    useEffect(() => {
        if (authStatus !== 'authenticated' || !linksLoadedForSession
            || (linksPhase !== 'ready' && linksPhase !== 'revealing')) return;
        const url = new URL(window.location.href);
        const taskIds = url.searchParams.getAll('agentTaskId');
        if (!taskIds.length) return;

        url.searchParams.delete('agentTaskId');
        window.history.replaceState(window.history.state, '', url);
        const id = Number(taskIds[0]);
        if (taskIds.length !== 1 || !Number.isSafeInteger(id) || id <= 0 || String(id) !== taskIds[0]) return;
        const task = links.find(link => link.id === id && link.ssoMethod === 'paasV2');
        if (task) refreshReturnedAgentTask(task);
    }, [authStatus, links, linksLoadedForSession, linksPhase, refreshReturnedAgentTask]);
    const {
        createPanel, setCreatePanel, creatingStudentCardId, deletingStudentKey,
        classActionKey, openingCompetitionKeys, repairFailuresByCard,
        handleCreateStudent, handleDeleteStudent, handleDeleteClass,
        handleInitializeClass, handleRepairAccountReadiness, handleRestoreClass,
        handleOpenCompetition, handleRequestManualCredential, handleOpenAdminEntry
    } = useCompetitionActions({
        token,
        currentUser,
        setLinks,
        studentAccountsByCard,
        setStudentAccountsByCard,
        trackAgentTaskReturn,
        refreshAgentTaskScore,
        refreshCompetitionBindings
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
    const [platformToEdit, setPlatformToEdit] = useState('');
    const [agentPlatforms, setAgentPlatforms] = useState(DEFAULT_AGENT_PLATFORMS);
    const [agentPlatformsLoadError, setAgentPlatformsLoadError] = useState('');
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const platformRequestRef = useRef(0);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
    const [isEditGiftModalOpen, setIsEditGiftModalOpen] = useState(false);
    const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
    const [isDeleteUserModalOpen, setIsDeleteUserModalOpen] = useState(false);

    const loadAgentPlatforms = useCallback(async ({ signal } = {}) => {
        if (!token) return [];
        const requestId = ++platformRequestRef.current;
        let data = await api.get('/paas-v2/platforms', { signal, fallback: '软件平台读取失败' });
        const legacy = isAdmin ? readLegacyAgentPlatforms() : [];
        if (legacy.length) {
            data = await api.post('/paas-v2/platforms/import', { platforms: legacy }, {
                signal, fallback: '浏览器软件平台同步失败', retry: 0
            });
            clearLegacyAgentPlatforms();
            notify('已将浏览器中的智能体软件数据同步到云端', 'success');
        }
        const platforms = normalizeAgentPlatforms(Array.isArray(data) ? data : data.platforms);
        if (requestId === platformRequestRef.current && !signal?.aborted) {
            setAgentPlatforms(platforms);
            setAgentPlatformsLoadError('');
        }
        return platforms;
    }, [token, isAdmin]);

    useEffect(() => {
        if (!token) {
            platformRequestRef.current += 1;
            setAgentPlatforms(DEFAULT_AGENT_PLATFORMS);
            setIsProfileModalOpen(false);
            return undefined;
        }
        const controller = new AbortController();
        loadAgentPlatforms({ signal: controller.signal }).catch(error => {
            if (error.name !== 'AbortError') setAgentPlatformsLoadError(error.message || '软件平台读取失败');
        });
        return () => controller.abort();
    }, [token, loadAgentPlatforms]);

    // 🎁 礼物状态管理
    const [isGiftMinimized, setIsGiftMinimized] = useState(false);
    const [activeGift, setActiveGift] = useState(null);

    // 📢 公告状态管理
    const [isAnnouncementVisible, setIsAnnouncementVisible] = useState(true);
    const [isAnnouncementClosing, setIsAnnouncementClosing] = useState(false);
    const [dashboardNow, setDashboardNow] = useState(() => Date.now());
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
        const isScheduled = !closeAt || Number.isNaN(closeAt) || closeAt > dashboardNow;
        return isScheduled && (
            currentUser?.role === 'super_admin' || !item.targetType || item.targetType === 'all' || item.targetType === currentUser?.role
        );
    }) || null, [announcements, currentUser?.role, dashboardNow]);

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
        const remaining = closeAt - dashboardNow;
        if (!Number.isFinite(remaining) || remaining <= 0) return undefined;
        const timer = window.setTimeout(triggerCloseAnnouncement, remaining);
        return () => window.clearTimeout(timer);
    }, [activeAnnouncement, isAnnouncementVisible, isAnnouncementClosing, dashboardNow, triggerCloseAnnouncement]);

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
            if (visible) setDashboardNow(Date.now() + serverTimeOffsetRef.current);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

    useEffect(() => {
        if (!isPageVisible) return undefined;
        const timer = window.setInterval(() => setDashboardNow(Date.now() + serverTimeOffsetRef.current), 30_000);
        return () => window.clearInterval(timer);
    }, [isPageVisible]);

    useEffect(() => {
        if (!currentUserId) return;
        setSettingsTab(currentUserRole === 'super_admin' ? 'api' : 'users');
    }, [currentUserId, currentUserRole]);

    const ADMIN_TABS = isAdmin ? [
        { id: 'api', label: 'API 设置', icon: Sparkles },
        { id: 'sso', label: '免密登录配置', icon: Key },
        { id: 'account-api', label: '账号管理 API', icon: Network },
        { id: 'database', label: '数据库配置', icon: Database },
        { id: 'email', label: '邮件服务', icon: Mail },
        { id: 'users', label: '用户管理', icon: Users },
        { id: 'announcements', label: '系统公告', icon: Megaphone },
        { id: 'gifts', label: '赠送礼物', icon: Gift },
        { id: 'site', label: '站点设置', icon: Palette }
    ] : [{ id: 'users', label: '用户管理', icon: Users }];

    // Effects
    useEffect(() => {
        if (currentUserId && token) {
            const updateDeviceInfo = async () => {
                const deviceInfo = { userAgent: navigator.userAgent, screenResolution: `${window.screen.width}x${window.screen.height}` };
                try { await api.patch(`/users/${currentUserId}/device`, deviceInfo, { retry: 0, fallback: '设备信息上报失败' }); } catch (e) { if (localStorage.getItem('authToken') === token) notify(e.message || '设备信息上报失败', 'warning'); }
            };
            updateDeviceInfo();
        }
    }, [currentUserId, token]);

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
            if (localStorage.getItem('authToken') === token && Array.isArray(rows)) setClassOptions(rows);
        } catch { /* 保留从用户列表派生的回退数据 */ }
    }, [token]);
    const searchUsersForGift = useCallback(async (keyword) => {
        const query = new URLSearchParams({ search: String(keyword || '').trim(), pageSize: '50', page: '1' });
        const data = await api.get(`/users?${query.toString()}`, { fallback: '用户搜索失败', retry: 0 });
        return Array.isArray(data) ? data : (data.users || []);
    }, []);
    const fetchSsoConfigs = useCallback(async () => {
        if (!token || !isAdmin) return;
        setSsoConfigsLoadError('');
        try {
            const configs = await api.get('/sso-config', { fallback: 'SSO 配置读取失败' });
            if (localStorage.getItem('authToken') === token) setSsoConfigs(configs);
        } catch (e) {
            if (localStorage.getItem('authToken') === token) setSsoConfigsLoadError(e.message || 'SSO 配置读取失败，请重试');
        }
    }, [isAdmin, token]);
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
                    setDashboardNow(serverTime);
                }
                setContentLoadError('');
                return true;
            } catch (e) {
                if (localStorage.getItem('authToken') !== requestToken) return false;
                setContentLoadError(e.message || '公告和礼物读取失败，请重试');
                return false;
            } finally {
                if (contentRequestRef.current === request) contentRequestRef.current = null;
            }
        })();
        contentRequestRef.current = request;
        return request;
    }, [token]);

    const fetchAiConfig = useCallback(async () => {
        if (!token) return;
        try {
            const serverConfig = await api.get('/ai/config', { fallback: 'AI 配置读取失败' });
            if (localStorage.getItem('authToken') !== token) return;
            setAiConfig({ ...DEFAULT_AI_CONFIG, ...serverConfig });
        } catch (e) { if (localStorage.getItem('authToken') === token) notify(e.message || 'AI 配置读取失败', 'warning'); }
    }, [token]);

    useEffect(() => {
        if (token && isAdmin && (isModalOpen || isTaskAppModalOpen || (activePage === 'settings' && settingsTab === 'sso'))) fetchSsoConfigs();
    }, [activePage, fetchSsoConfigs, isAdmin, isModalOpen, isTaskAppModalOpen, settingsTab, token]);

    useEffect(() => {
        setContentLoadError('');
        contentRevisionRef.current = { announcements: '', gifts: '' };
        contentRequestRef.current = null;
        usersRequestIdRef.current += 1;
        setUsers([]); setPermissions({}); setUserTimeRules({}); setClassOptions([]);
        setUsersLoadError(''); setUsersLoading(false); setUsersPage(1);
        setSsoConfigs([]); setSsoConfigsLoadError(''); setIsProfileModalOpen(false);
        setIsModalOpen(false); setIsTaskAppModalOpen(false); setIsPermissionModalOpen(false); setIsAddUserModalOpen(false); setIsDeleteUserModalOpen(false);
        setAnnouncements([]); setGifts([]); setActiveGift(null);
        setAiConfig(DEFAULT_AI_CONFIG);
        if (token && currentUserId) {
            fetchLinks({ animate: true });
            fetchStudentAccounts();
            fetchAiConfig();
        } else {
            resetCompetitionCatalog();
            setAnnouncements([]);
            setGifts([]);
        }
    }, [currentUserId, currentUserRole, fetchAiConfig, fetchLinks, fetchStudentAccounts, resetCompetitionCatalog, token]);

    useEffect(() => {
        if (!token || !currentUserId || !isPageVisible) return undefined;
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
    }, [currentUserId, currentUserRole, fetchSharedContent, isPageVisible, token]);

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
            default: break;
        }
        if (settingsTab === 'users') fetchClasses();
        return () => controller.abort();
    }, [activePage, canManageUsers, debouncedUsersSearch, fetchClasses, fetchUsers, settingsTab, token, usersPage]);

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
            const moduleTitle = String(link.agentModule?.title || '').toLocaleLowerCase('zh-CN');
            return title.includes(keyword) || category.includes(keyword) || moduleTitle.includes(keyword);
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
        const metadata = new Map(agentPlatforms.map(platform => [normalizePlatformKey(platform.softwareUnique), platform]));
        const allItems = new Map();
        for (const link of links.filter(item => item.ssoMethod === 'paasV2')) {
            const key = normalizePlatformKey(link.paasV2SoftwareUnique || link.softwareUnique || 'PT04');
            if (!allItems.has(key)) allItems.set(key, []);
            allItems.get(key).push(link);
        }
        const groups = {};
        agentLinks.forEach(link => {
            const key = link.paasV2SoftwareUnique || link.softwareUnique || 'PT04';
            const normalizedKey = normalizePlatformKey(key);
            if (!groups[normalizedKey]) {
                const platform = metadata.get(normalizedKey);
                groups[normalizedKey] = {
                    key, platform,
                    label: platformLabel(platform, link.category || key),
                    theme: normalizeAgentPlatformTheme(platform?.theme),
                    sortOrder: platform?.sortOrder ?? 1000,
                    items: [], allItems: allItems.get(normalizedKey) || []
                };
            }
            groups[normalizedKey].items.push(link);
        });
        return Object.entries(groups).sort(([, left], [, right]) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'zh-CN'));
    }, [agentLinks, agentPlatforms, links]);
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
        const ids = [...new Set((group?.allItems || group?.items || []).map(link => link.id).filter(Boolean))];
        if (!ids.length) return;
        if (!await confirmAction({
            title: '删除智能体模块',
            message: `确定要删除「${group.label}」下的 ${ids.length} 个智能体任务吗？删除后无法恢复。`,
            confirmText: '删除模块'
        })) return;
        try {
            const result = await api.post('/competitions/batch-delete', { ids }, { fallback: '删除失败', timeoutMs: 60_000, retry: 0 });
            await fetchLinks();
            notify(`已删除 ${result.deleted} 个智能体任务`, 'success');
        } catch (error) {
            notify(error.message || '删除失败', 'error');
        }
    };

    const handleAdminAddUser = async (newUsers) => {
        try {
            const result = await api.post('/users/batch', { users: newUsers }, { fallback: '批量创建用户失败', timeoutMs: 60_000, retry: 0 });
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
            id: crypto.randomUUID(),
            targetUserId: uid,
            title: giftForm.title,
            content: giftForm.content,
            type: giftForm.type,
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

    const dashboardAlignClass = {
        left: 'text-left items-start',
        center: 'text-center items-center',
        right: 'text-right items-end'
    }[siteConfig.dashboardTextAlign || 'left'];
    const hasImmersiveWallpaper = Object.hasOwn(IMMERSIVE_WALLPAPERS, activeImmersive);

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


    return (
        <div className={`${isDarkMode ? 'dark' : ''} min-h-screen w-full relative ${
            systemEffects.dashboardCardReveal === false ? 'system-effects-no-card-reveal' : ''
        } ${uiThemeSettings.effectMode === 'default' ? 'system-background-default' : ''}`} style={accentStyle}>

            <FeedbackCenter />
            <div className="fixed left-1/2 top-4 z-[200] w-[min(92vw,560px)] -translate-x-1/2">
                <LoadErrorNotice message={siteConfigLoadError} onRetry={fetchSiteConfig} />
            </div>
            {renderBackground(activePage === 'settings')}

            <div className="relative z-10 min-h-screen flex flex-col">
                <Navbar
                    isAdmin={isAdmin} canManageUsers={canManageUsers} user={currentUser} onLogout={handleLogout}
                    onOpenProfile={() => setIsProfileModalOpen(true)}
                    activePage={activePage} setActivePage={setActivePage}
                    siteConfig={siteConfig} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
                    onAdd={() => { setEditingLink(null); setIsModalOpen(true); }}
                    onAddTaskApp={() => { setEditingLink(null); setTaskAppSoftwareUnique(''); setPlatformToEdit(''); setIsTaskAppModalOpen(true); }}
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
                                {settingsTab === 'sso' && <SsoManager configs={ssoConfigs} token={token} fetchConfigs={fetchSsoConfigs} onBindingsChange={refreshCompetitionBindings} loadError={ssoConfigsLoadError} onRetry={fetchSsoConfigs} />}
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
                                {settingsTab === 'site' && (
                                    <SiteSettings
                                        config={siteConfig}
                                        onSaveContent={persistSiteConfig}
                                        settings={uiThemeSettings}
                                        effectiveLightDark={effectiveLightDark}
                                        onSaveAppearance={saveUiThemeSettings}
                                        token={token}
                                    />
                                )}
                                {settingsTab === 'database' && <DatabaseManager token={token} />}
                                {settingsTab === 'account-api' && <AccountManagementApiManager token={token} onBindingsChange={refreshCompetitionBindings} />}
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

                            <header className={`mb-8 relative flex flex-col ${dashboardAlignClass} ${isNavbarTransitioning ? 'dashboard-hero-entering' : ''}`}>
                                <LoadErrorNotice message={contentLoadError || studentAccountsLoadError} onRetry={() => { fetchSharedContent(); fetchStudentAccounts(); }} compact />
                                {siteConfig.dailyQuote && (
                                    <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-indigo-50/50 border border-indigo-100/50 backdrop-blur-sm w-fit animate-in fade-in slide-in-from-top-2">
                                        <Quote className="w-3 h-3 text-indigo-500 fill-indigo-500" />
                                        <span className="text-xs font-bold text-indigo-600/90">{siteConfig.dailyQuote}</span>
                                    </div>
                                )}
                                <h1 className={`font-black text-4xl ${hasImmersiveWallpaper ? 'text-white' : 'text-slate-900 dark:text-white'} ${INK_TEXT_SHADOW}`}>
                                    {(siteConfig.welcomeTitle || "Hello, {username} 👋").replace('{username}', currentUser?.username || 'User')}
                                </h1>
                                {siteConfig.welcomeSubtitle && (
                                    <p className={`mt-2 font-medium ${hasImmersiveWallpaper ? 'text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
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
                                                            <Suspense fallback={<CardLoadingNotice />}>
                                                                <ContestCard
                                                                    now={dashboardNow}
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
                                                                    classActionKey={classActionKey}
                                                                    repairFailureCount={repairFailuresByCard?.[link.id]?.length}
                                                                />
                                                            </Suspense>
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        ))}
                                    </div>
                                )}

                                {agentPlatformGroups.length > 0 && (
                                    <div className="agent-task-modules mt-8 space-y-6">
                                        <LoadErrorNotice message={agentPlatformsLoadError} onRetry={() => loadAgentPlatforms().catch(error => setAgentPlatformsLoadError(error.message))} compact />
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-lg font-black text-slate-800 dark:text-white">智能体任务</h2>
                                            <span className="rounded-full bg-violet-100 px-3 py-1 text-[10px] font-black text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">{agentLinks.length} 个任务</span>
                                        </div>
                                        {agentPlatformGroups.map(([key, group]) => (
                                            <section key={key} style={agentPlatformThemeStyle(group.theme)} className="agent-task-module overflow-hidden rounded-[28px] border border-white/70 bg-white/55 p-4 shadow-[0_18px_50px_rgba(80,70,229,0.10)] backdrop-blur-xl sm:p-5 dark:border-violet-900/50 dark:bg-slate-900/55">
                                                <div className="mb-4 flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="agent-task-module-icon grid h-9 w-9 shrink-0 place-items-center rounded-2xl text-white shadow-sm"><Sparkles className="h-4 w-4" /></span>
                                                        <div><h3 className="agent-task-module-title text-sm font-black">{group.label}</h3><p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">共 {group.items.length} 个任务</p></div>
                                                    </div>
                                                    {isAdmin && isCardEditMode && (
                                                        <div className="flex shrink-0 items-center gap-1.5">
                                                            <button type="button" onClick={() => { setEditingLink(null); setTaskAppSoftwareUnique(group.key); setPlatformToEdit(group.key); setIsTaskAppModalOpen(true); }} className="mc-button mc-button--secondary mc-button--compact !px-2.5 !text-[10px]"><Edit2 className="h-3 w-3" />编辑模块</button>
                                                            <button type="button" onClick={() => handleDeleteAgentPlatform(group)} className="flex h-8 items-center gap-1 rounded-xl border border-red-200 bg-white/90 px-2.5 text-[10px] font-bold text-red-500 shadow-sm hover:bg-red-50"><Trash2 className="h-3 w-3" />删除模块</button>
                                                        </div>
                                                    )}
                                                </div>
                                                <AgentTaskGroups items={group.items} label={group.label} renderTask={link => (
                                                        <Suspense key={link.id} fallback={<CardLoadingNotice />}>
                                                            <AgentTaskCard
                                                                link={link}
                                                                theme={group.theme}
                                                                isAdmin={isAdmin}
                                                                onEdit={(l)=>{setEditingLink(l); setPlatformToEdit(''); setIsTaskAppModalOpen(true);}}
                                                                onDelete={handleDelete}
                                                                onOpen={handleOpenCompetition}
                                                                onReset={handleResetAgentTask}
                                                                scoreResult={agentScoreStates[link.id]?.result}
                                                                scoreLoading={agentScoreStates[link.id]?.loading}
                                                                scoreError={agentScoreStates[link.id]?.error}
                                                                resetting={agentScoreStates[link.id]?.resetting}
                                                                onRefreshScore={refreshAgentTaskScore}
                                                                openingCompetitionKeys={openingCompetitionKeys}
                                                                isCardEditMode={isCardEditMode}
                                                            />
                                                        </Suspense>
                                                )} />
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
                        <p className={`site-footer-copy font-bold ${hasImmersiveWallpaper ? 'text-slate-100' : 'text-slate-400/80 dark:text-slate-600'} ${getFooterSizeClass()}`}>
                            {siteConfig.footerText || DEFAULT_SITE_CONFIG.footerText}
                        </p>
                    </footer>
                )}

            </div>

            <Suspense fallback={<ModalLoadingNotice />}>
                {isModalOpen && <EditModal isOpen onClose={() => setIsModalOpen(false)} onSave={handleSave} initialData={editingLink} existingCategories={competitionFieldHistory.categories} existingTitles={competitionFieldHistory.titles} ssoConfigs={ssoConfigs} authToken={token} />}
                {isTaskAppModalOpen && <TaskAppModal isOpen onClose={() => { setIsTaskAppModalOpen(false); setPlatformToEdit(''); }} onSave={async () => { setEditingLink(null); await fetchLinks(); }} onCatalogRefreshed={fetchLinks} onPlatformsChange={async () => { const platforms = await loadAgentPlatforms(); await fetchLinks({ animate: false }); return platforms; }} platforms={agentPlatforms} initialData={editingLink} initialSoftwareUnique={taskAppSoftwareUnique} initialPlatformSoftwareUnique={platformToEdit} ssoConfigs={ssoConfigs} existingLinks={links} />}
                {isAiModalOpen && <AiGuideModal isOpen onClose={() => setIsAiModalOpen(false)} link={currentAiLink} aiConfig={aiConfig} />}
                {isPermissionModalOpen && <PermissionModal isOpen onClose={() => setIsPermissionModalOpen(false)} user={targetUserForPermission} allLinks={links} agentPlatforms={agentPlatforms} currentPermissions={targetUserForPermission ? (permissions[targetUserForPermission.id] || []) : []} currentUserTimeRules={targetUserForPermission ? (userTimeRules[targetUserForPermission.id] || {}) : {}} onSave={handleSavePermissions} />}
                {isProfileModalOpen && <ProfileModal isOpen user={currentUser} onClose={() => setIsProfileModalOpen(false)} onSaved={handleProfileSaved} />}
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

            <Suspense fallback={<ModalLoadingNotice />}>
                {isEditGiftModalOpen && <EditGiftModal isOpen onClose={() => setIsEditGiftModalOpen(false)} gift={editingGift} onSave={handleUpdateGift} />}
                {isAddUserModalOpen && (
                    <AddUserModal
                        isOpen
                        onClose={() => setIsAddUserModalOpen(false)}
                        onAdd={handleAdminAddUser}
                        currentUser={currentUser}
                        classes={availableClasses}
                        allLinks={links}
                        agentPlatforms={agentPlatforms}
                    />
                )}
                {isDeleteUserModalOpen && <DeleteUserModal isOpen onClose={() => setIsDeleteUserModalOpen(false)} onDelete={handleAdminDeleteUser} users={users} currentUser={currentUser} />}
            </Suspense>
        </div>
    );
}
