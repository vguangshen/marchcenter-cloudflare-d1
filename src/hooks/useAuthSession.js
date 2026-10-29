import { useCallback, useEffect, useRef, useState } from 'react';
import { api, onUnauthorized } from '../utils/api';
import { prefersReducedMotion } from '../utils/motionPreferences';
import { notify } from '../utils/uiFeedback';

export function useAuthSession() {
    const [currentUser, setCurrentUser] = useState(() => {
        if (!localStorage.getItem('authToken')) return null;
        try { return JSON.parse(localStorage.getItem('authUser') || 'null'); }
        catch { return null; }
    });
    const [isUnlocking, setIsUnlocking] = useState(false);
    const [isNavbarTransitioning, setIsNavbarTransitioning] = useState(false);
    const [token, setToken] = useState(() => localStorage.getItem('authToken'));
    const [authStatus, setAuthStatus] = useState(() => token ? 'checking' : 'anonymous');
    const verifiedTokenRef = useRef(null);
    const pendingLoginRef = useRef(null);

    const updateCurrentUser = useCallback((user) => {
        if (!user || typeof user !== 'object' || !user.id) throw new Error('用户状态无效');
        setCurrentUser(user);
        localStorage.setItem('authUser', JSON.stringify(user));
        return user;
    }, []);

    const refreshCurrentUser = useCallback(async () => {
        const requestToken = localStorage.getItem('authToken');
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
        if (!pending) return;
        pendingLoginRef.current = null;
        setCurrentUser(pending.user);
        setToken(pending.tokenValue);
        setAuthStatus('authenticated');
        setIsUnlocking(false);
        setIsNavbarTransitioning(pending.shouldAnimate);
    }, []);

    const logout = useCallback(() => {
        pendingLoginRef.current = null;
        setIsUnlocking(false);
        setIsNavbarTransitioning(false);
        setCurrentUser(null);
        setToken(null);
        setAuthStatus('anonymous');
        localStorage.removeItem('authUser');
        localStorage.removeItem('authToken');
    }, []);

    const login = useCallback((user, tokenValue, { animate = true } = {}) => {
        const shouldAnimate = Boolean(
            animate
            && !prefersReducedMotion()
            && document.visibilityState !== 'hidden'
        );
        localStorage.setItem('authUser', JSON.stringify(user));
        localStorage.setItem('authToken', tokenValue);
        verifiedTokenRef.current = tokenValue;
        pendingLoginRef.current = { user, tokenValue, shouldAnimate };
        setIsUnlocking(shouldAnimate);
        if (!shouldAnimate) completeLoginTransition();
    }, [completeLoginTransition]);

    useEffect(() => {
        if (!token) {
            setCurrentUser(null);
            setAuthStatus('anonymous');
            localStorage.removeItem('authUser');
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
                localStorage.setItem('authUser', JSON.stringify(data.user));
            })
            .catch(error => {
                if (error.name === 'AbortError' || controller.signal.aborted || localStorage.getItem('authToken') !== token) return;
                if (error.status === 401) logout();
                else {
                    let cachedUser = null;
                    try { cachedUser = JSON.parse(localStorage.getItem('authUser') || 'null'); }
                    catch { /* invalid cache is ignored */ }
                    if (cachedUser) {
                        setCurrentUser(cachedUser);
                        setAuthStatus('authenticated');
                        notify(error.message || '登录服务暂时不可用，已保留当前会话', 'warning');
                    } else {
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
