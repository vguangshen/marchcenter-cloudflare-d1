import { useCallback, useEffect, useRef, useState } from 'react';
import { api, onUnauthorized } from '../utils/api';
import { getTabToken, setTabToken } from '../utils/tabSession';
import { prefersReducedMotion } from '../utils/motionPreferences';
import { notify } from '../utils/uiFeedback';

function readCachedUser(token) {
    if (!token) return null;
    try {
        const cached = JSON.parse(localStorage.getItem('authUser') || 'null');
        if (!cached) return null;
        if (Object.hasOwn(cached, 'token')) return cached.token === token ? cached.user : null;

        // Legacy caches stored just a profile. Match its owner before using it
        // while offline. The server still verifies the token on every API call.
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const claims = JSON.parse(new TextDecoder().decode(bytes));
        return cached.id != null && String(cached.id) === String(claims.id) && cached.role === claims.role ? cached : null;
    } catch { return null; }
}

function cacheUser(token, user) {
    localStorage.setItem('authUser', JSON.stringify({ token, user }));
}

export function useAuthSession() {
    const [currentUser, setCurrentUser] = useState(() => readCachedUser(getTabToken()));
    const [isUnlocking, setIsUnlocking] = useState(false);
    const [isNavbarTransitioning, setIsNavbarTransitioning] = useState(false);
    const [token, setToken] = useState(getTabToken);
    const [authStatus, setAuthStatus] = useState(() => token ? 'checking' : 'anonymous');
    const verifiedTokenRef = useRef(null);
    const pendingLoginRef = useRef(null);

    const sessionChangedElsewhere = useCallback(() => {
        if (getTabToken() === localStorage.getItem('authToken')) return false;
        window.location.reload();
        return true;
    }, []);

    useEffect(() => {
        const onStorage = event => {
            if (event.storageArea === localStorage && (event.key === 'authToken' || event.key === null)) sessionChangedElsewhere();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('pageshow', sessionChangedElsewhere);
        sessionChangedElsewhere();
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('pageshow', sessionChangedElsewhere);
        };
    }, [sessionChangedElsewhere]);

    const updateCurrentUser = useCallback((user) => {
        if (!token || token !== localStorage.getItem('authToken')) return null;
        if (!user || typeof user !== 'object' || !user.id) throw new Error('用户状态无效');
        setCurrentUser(user);
        cacheUser(token, user);
        return user;
    }, [token]);

    const refreshCurrentUser = useCallback(async () => {
        const requestToken = getTabToken();
        if (!requestToken) return null;
        const data = await api.get('/auth/me', { retry: 0, fallback: '用户状态刷新失败' });
        if (localStorage.getItem('authToken') !== requestToken) return null;
        return updateCurrentUser(data.user);
    }, [updateCurrentUser]);

    const completeNavbarTransition = useCallback(() => {
        setIsNavbarTransitioning(false);
    }, []);

    const completeLoginTransition = useCallback(() => {
        const pending = pendingLoginRef.current;
        if (!pending || sessionChangedElsewhere()) return;
        pendingLoginRef.current = null;
        setCurrentUser(pending.user);
        setToken(pending.tokenValue);
        setAuthStatus('authenticated');
        setIsUnlocking(false);
        setIsNavbarTransitioning(pending.shouldAnimate);
    }, [sessionChangedElsewhere]);

    const logout = useCallback(() => {
        if (sessionChangedElsewhere()) return;
        pendingLoginRef.current = null;
        setIsUnlocking(false);
        setIsNavbarTransitioning(false);
        setCurrentUser(null);
        setToken(null);
        setAuthStatus('anonymous');
        localStorage.removeItem('authUser');
        localStorage.removeItem('authToken');
        setTabToken(null);
    }, [sessionChangedElsewhere]);

    const login = useCallback((user, tokenValue, { animate = true } = {}) => {
        if (sessionChangedElsewhere()) return;
        const shouldAnimate = Boolean(
            animate
            && !prefersReducedMotion()
            && document.visibilityState !== 'hidden'
        );
        cacheUser(tokenValue, user);
        localStorage.setItem('authToken', tokenValue);
        setTabToken(tokenValue);
        verifiedTokenRef.current = tokenValue;
        pendingLoginRef.current = { user, tokenValue, shouldAnimate };
        setIsUnlocking(shouldAnimate);
        if (!shouldAnimate) completeLoginTransition();
    }, [completeLoginTransition, sessionChangedElsewhere]);

    useEffect(() => {
        if (!token) {
            setCurrentUser(null);
            setAuthStatus('anonymous');
            return undefined;
        }
        if (verifiedTokenRef.current === token) {
            verifiedTokenRef.current = null;
            setAuthStatus('authenticated');
            return undefined;
        }
        setAuthStatus('checking');
        const controller = new AbortController();
        api.get('/auth/me', { signal: controller.signal, retry: 0, fallback: '登录状态校验失败' })
            .then(data => {
                if (controller.signal.aborted || localStorage.getItem('authToken') !== token) return;
                setCurrentUser(data.user);
                setAuthStatus('authenticated');
                cacheUser(token, data.user);
            })
            .catch(error => {
                if (error.name === 'AbortError' || controller.signal.aborted || localStorage.getItem('authToken') !== token) return;
                if (error.status === 401) logout();
                else {
                    const cachedUser = readCachedUser(token);
                    if (cachedUser) {
                        setCurrentUser(cachedUser);
                        setAuthStatus('authenticated');
                        notify(error.message || '登录服务暂时不可用，已保留当前会话', 'warning');
                    } else {
                        setCurrentUser(null);
                        setAuthStatus('unavailable');
                        notify(error.message || '登录状态暂时无法校验，请稍后重试', 'warning');
                    }
                }
            });
        return () => controller.abort();
    }, [token, logout]);

    useEffect(() => onUnauthorized(event => {
        const activeToken = localStorage.getItem('authToken');
        if (!activeToken) return;
        if (Object.hasOwn(event?.detail || {}, 'token') && event.detail.token !== activeToken) return;
        logout();
        notify('登录状态已失效或账号已被禁用，请重新登录', 'warning');
    }), [logout]);

    return {
        currentUser,
        token,
        authStatus,
        isUnlocking,
        isNavbarTransitioning,
        completeLoginTransition,
        completeNavbarTransition,
        isAdmin: currentUser?.role === 'super_admin',
        canManageUsers: ['super_admin', 'admin', 'teacher'].includes(currentUser?.role),
        handleLoginSuccess: login,
        updateCurrentUser,
        refreshCurrentUser,
        handleLogout: logout
    };
}
