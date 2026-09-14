import React, { useState, useEffect } from 'react';
import { Globe, Cpu, CircleHelp } from 'lucide-react';
import { apiFetch } from '../../../utils/api';

const CdnIndicator = () => {
    const [status, setStatus] = useState({
        isCdn: false,
        provider: 'Detecting...',
        info: 'Network Analysis',
        type: 'loading' // loading | cdn | origin | local
    });

    const [visible, setVisible] = useState(false);

    useEffect(() => {
        let disposed = false;
        let requestController = null;
        const checkNetworkStatus = async () => {
            // 1. 本地环境检测
            const hostname = window.location.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
                setStatus({
                    isCdn: false,
                    provider: 'Localhost',
                    info: 'Dev Environment',
                    type: 'local'
                });
                setVisible(true);
                return;
            }

            try {
                // 2. 尝试检测 Cloudflare
                requestController = new AbortController();
                const res = await apiFetch(`${window.location.origin}/cdn-cgi/trace`, {
                    method: 'GET',
                    timeoutMs: 2000,
                    retry: 0,
                    signal: requestController.signal,
                    headers: { 'Content-Type': 'text/plain' }
                });

                const text = await res.text();

                // A proxied 404 may be rewritten to the SPA document, so only
                // treat the response as Cloudflare trace data when colo exists.
                if (res.ok && text.includes('colo=')) {
                    const data = text.split('\n').reduce((acc, line) => {
                        const [k, v] = line.split('=');
                        if (k && v) acc[k] = v;
                        return acc;
                    }, {});

                    setStatus({
                        isCdn: true,
                        provider: 'Cloudflare CDN',
                        info: `Node: ${data.colo} | IP: ${data.ip}`,
                        type: 'cdn'
                    });
                } else {
                    // 虽然通了，但内容不对，判定为源站
                    throw new Error('Not Valid CF Trace');
                }
            } catch {
                if (!disposed) {
                    // /cdn-cgi/trace 超时或被扩展拦截无法证明请求绕过 CDN。
                    // 明确显示“检测不可用”，避免把未知网络状态误报成源站直连。
                    setStatus({
                        isCdn: false,
                        provider: '检测不可用',
                        info: '无法确认当前网络路径',
                        type: 'unknown'
                    });
                }
            } finally {
                if (!disposed) setVisible(true);
            }
        };

        checkNetworkStatus();
        return () => {
            disposed = true;
            requestController?.abort();
        };
    }, []);

    if (!visible) return null;

    // --- 🎨 动态配色方案 ---
    const getTheme = () => {
        switch (status.type) {
            case 'cdn': // 🟢 CDN 模式：绿色，代表加速
                return {
                    container: 'bg-emerald-50/90 border-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:border-emerald-700 dark:text-emerald-300',
                    icon: <Globe className="h-3.5 w-3.5" />,
                    dot: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
                };
            case 'unknown':
                return {
                    container: 'bg-amber-50/90 border-amber-200 text-amber-700 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-300',
                    icon: <CircleHelp className="w-3.5 h-3.5" />,
                    dot: 'bg-amber-400'
                };
            case 'local': // ⚫ 本地模式：灰色
            default:
                return {
                    container: 'bg-slate-50/90 border-slate-200 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400',
                    icon: <Cpu className="w-3.5 h-3.5" />,
                    dot: 'bg-slate-400'
                };
        }
    };

    const theme = getTheme();
    const shortProvider = status.type === 'cdn'
        ? 'CDN'
        : status.type === 'unknown'
            ? '未知'
            : '本地';

    return (
        <div
            className={`login-cdn-indicator border backdrop-blur-md ${theme.container}`}
            title={`${status.provider} · ${status.info}`}
            aria-label={`${status.provider}，${status.info}`}
        >
            <div className="flex shrink-0 items-center justify-center">
                {theme.icon}
            </div>

            <div className="login-cdn-copy">
                <span className="login-cdn-provider">
                    <span className="login-cdn-provider-full">
                        {status.provider}
                    </span>
                    <span className="login-cdn-provider-short">
                        {shortProvider}
                    </span>
                </span>
                <span className="login-cdn-info">
                    {status.info}
                </span>
            </div>

            <div
                className={`login-cdn-dot h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`}
                aria-hidden="true"
            />
        </div>
    );
};

export default CdnIndicator;
