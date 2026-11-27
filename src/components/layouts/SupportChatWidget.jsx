import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Headset, Loader2 } from 'lucide-react';
import { api } from '../../utils/api';
import { getTabToken } from '../../utils/tabSession';

const SupportChatPanel = lazy(() => import('../support-chat/SupportChatPanel'));
const UNREAD_REFRESH_MS = 12_000;

export default function SupportChatWidget({ token, isStaff }) {
    const [mode, setMode] = useState('idle');
    const [unread, setUnread] = useState(null);
    const dockRef = useRef(null);
    const launcherRef = useRef(null);
    const requestRef = useRef(null);
    const expanded = mode === 'expanded';
    const count = unread && unread.token === token ? unread.count : 0;

    const refreshUnread = useCallback(() => {
        if (getTabToken() !== token) return;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        api.get('/support-chat/unread', { signal: controller.signal, retry: 0 })
            .then(result => {
                if (!controller.signal.aborted && getTabToken() === token) {
                    setUnread({ token, count: Math.max(0, Number(result?.total) || 0) });
                }
            })
            .catch(() => { /* Keep the last badge while the chat service reconnects. */ })
            .finally(() => {
                if (requestRef.current === controller) requestRef.current = null;
            });
    }, [token]);

    useEffect(() => {
        const refreshVisible = () => {
            if (document.visibilityState === 'visible') refreshUnread();
        };
        refreshVisible();
        const timer = window.setInterval(refreshVisible, UNREAD_REFRESH_MS);
        document.addEventListener('visibilitychange', refreshVisible);
        return () => {
            requestRef.current?.abort();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refreshVisible);
        };
    }, [refreshUnread]);

    useEffect(() => {
        const viewport = window.visualViewport;
        const dock = dockRef.current;
        if (!expanded || !viewport || !dock) return undefined;
        const reset = () => {
            dock.style.removeProperty('--support-chat-keyboard');
            dock.style.removeProperty('--support-chat-viewport-height');
        };
        const fitViewport = () => {
            if (viewport.scale !== 1) { reset(); return; }
            const offset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
            dock.style.setProperty('--support-chat-keyboard', `${offset}px`);
            dock.style.setProperty('--support-chat-viewport-height', `${viewport.height}px`);
        };
        fitViewport();
        viewport.addEventListener('resize', fitViewport);
        viewport.addEventListener('scroll', fitViewport);
        return () => {
            viewport.removeEventListener('resize', fitViewport);
            viewport.removeEventListener('scroll', fitViewport);
            reset();
        };
    }, [expanded]);

    const minimize = useCallback(() => {
        setMode('collapsed');
        window.requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
        refreshUnread();
    }, [refreshUnread]);

    const label = count > 0 ? `打开客服，${count} 条未读消息` : '打开客服';
    return (
        <div className="support-chat-dock" ref={dockRef}>
            <button
                ref={launcherRef}
                type="button"
                className="support-chat-launcher"
                hidden={expanded}
                aria-expanded={expanded}
                aria-controls={mode !== 'idle' ? 'support-chat-panel' : undefined}
                aria-label={label}
                title="打开客服"
                onClick={() => setMode('expanded')}
            >
                <Headset className="h-6 w-6" aria-hidden="true" />
                {count > 0 && <span className="support-chat-launcher__badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
            </button>
            {mode !== 'idle' && (
                <Suspense fallback={expanded && (
                    <button type="button" className="support-chat-launcher" onClick={minimize} aria-label="取消打开客服" title="正在打开客服…">
                        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                    </button>
                )}>
                    <SupportChatPanel expanded={expanded} isStaff={isStaff} onMinimize={minimize} onUnreadChange={refreshUnread} />
                </Suspense>
            )}
        </div>
    );
}
