import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Check, Cloud, Download, ImagePlus, Loader2, RefreshCw, Trash2, Upload
} from 'lucide-react';
import { wallpaperContentUrl } from '../../../constants/config';
import { api } from '../../../utils/api';
import { confirmAction } from '../../../utils/uiFeedback';
import { extractThemeFromFile } from '../../../utils/imageTheme';
import LoadErrorNotice from '../../feedback/LoadErrorNotice';

const formatBytes = (value) => {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

// 壁纸行/上传/同步响应的 theme_accent 是服务端落库的 JSON 字符串；
// 选择壁纸时必须把它带进 onSave 载荷，否则 App 内仍沿用上一张壁纸的
// 旧 accent，直到整页刷新才纠正。
const parseThemeAccent = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const WallpaperManager = ({ settings, onSave, token }) => {
    const [wallpapers, setWallpapers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);
    const [loadError, setLoadError] = useState('');
    const fileInputRef = useRef(null);

    const request = useCallback(async (path, options = {}) => {
        const { method = 'GET', body, ...requestOptions } = options;
        const headers = {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(requestOptions.headers || {})
        };
        const normalizedBody = typeof body === 'string' ? JSON.parse(body) : body;
        const requestPath = `/wallpapers${path}`;
        if (method.toUpperCase() === 'DELETE') return api.delete(requestPath, { ...requestOptions, headers });
        if (method.toUpperCase() === 'GET') return api.get(requestPath, { ...requestOptions, headers });
        const methodClient = api[method.toLowerCase()];
        if (typeof methodClient !== 'function') throw new Error(`不支持的请求方法：${method}`);
        return methodClient(requestPath, normalizedBody, { ...requestOptions, headers });
    }, [token]);

    const loadWallpapers = useCallback(async () => {
        setLoadError('');
        try {
            const data = await request('');
            setWallpapers(data.wallpapers || []);
        } catch (error) {
            setLoadError(error.message || '壁纸列表读取失败');
        } finally {
            setLoading(false);
        }
    }, [request]);

    useEffect(() => {
        loadWallpapers();
    }, [loadWallpapers]);

    const latestBing = useMemo(
        () => wallpapers.find((item) => item.source_type === 'bing') || null,
        [wallpapers]
    );
    const libraryWallpapers = wallpapers;
    const isBingActive = (
        settings.effectMode === 'wallpaper'
        && settings.backgroundMode === 'bing'
        && Number(settings.wallpaperId) > 0
    );

    const syncBing = async ({ enable = false } = {}) => {
        setBusy(enable ? 'enable-bing' : 'sync-bing');
        setMessage(null);
        try {
            const data = await request('/bing/sync', {
                method: 'POST',
                body: {},
                timeoutMs: 90_000
            });
            const wallpaper = data.wallpaper;
            await loadWallpapers();
            if (enable || isBingActive) {
                await onSave({
                    ...settings,
                    effectMode: 'wallpaper',
                    immersive: null,
                    backgroundMode: 'bing',
                    wallpaperId: Number(wallpaper.id),
                    wallpaperVersion: wallpaper.content_hash,
                    themeAccent: parseThemeAccent(wallpaper.theme_accent)
                });
            }
            setMessage({
                type: 'success',
                text: enable ? '已启用 Bing 每日壁纸' : 'Bing 最新壁纸已保存到图库'
            });
            return wallpaper;
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
            return null;
        } finally {
            setBusy('');
        }
    };

    const enableBing = async () => {
        if (!latestBing) {
            await syncBing({ enable: true });
            return;
        }
        setBusy('enable-bing');
        await onSave({
            ...settings,
            effectMode: 'wallpaper',
            immersive: null,
            backgroundMode: 'bing',
            wallpaperId: Number(latestBing.id),
            wallpaperVersion: latestBing.content_hash,
            themeAccent: parseThemeAccent(latestBing.theme_accent)
        });
        setMessage({ type: 'success', text: '已启用 Bing 每日壁纸' });
        setBusy('');
    };

    const selectWallpaper = async (wallpaper) => {
        setBusy(`select-${wallpaper.id}`);
        await onSave({
            ...settings,
            effectMode: 'wallpaper',
            immersive: null,
            backgroundMode: 'wallpaper',
            wallpaperId: Number(wallpaper.id),
            wallpaperVersion: wallpaper.content_hash,
            themeAccent: parseThemeAccent(wallpaper.theme_accent)
        });
        setBusy('');
    };

    const uploadWallpaper = async (file) => {
        if (!file) return;
        setBusy('upload');
        setMessage(null);
        try {
            // 客户端计算主题色 accent（与登录页同一算法），随完整图提交，
            // 服务端落库存储——上传图可能是 WebP/PNG，服务端纯 JS 无法解码。
            const accent = await extractThemeFromFile(file);
            const form = new FormData();
            form.append('image', file);
            if (accent) form.append('accent', JSON.stringify(accent));
            const data = await request('/upload', {
                method: 'POST',
                body: form
            });
            await loadWallpapers();
            await onSave({
                ...settings,
                effectMode: 'wallpaper',
                immersive: null,
                backgroundMode: 'wallpaper',
                wallpaperId: Number(data.wallpaper.id),
                wallpaperVersion: data.wallpaper.content_hash,
                themeAccent: parseThemeAccent(data.wallpaper.theme_accent)
            });
            setMessage({ type: 'success', text: '图片已上传，并设置为当前背景' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
            setBusy('');
        }
    };

    const removeWallpaper = async (event, wallpaper) => {
        event.stopPropagation();
        if (!await confirmAction({
            title: '删除壁纸',
            message: `确认删除“${wallpaper.title || '这张壁纸'}”吗？`,
            confirmText: '删除'
        })) return;
        setBusy(`delete-${wallpaper.id}`);
        setMessage(null);
        try {
            await request(`/${wallpaper.id}`, { method: 'DELETE' });
            if (Number(settings.wallpaperId) === Number(wallpaper.id)) {
                await onSave({
                    ...settings,
                    effectMode: 'default',
                    immersive: null,
                    backgroundMode: 'default',
                    wallpaperId: null,
                    wallpaperVersion: null,
                    themeAccent: null
                });
            }
            await loadWallpapers();
            setMessage({ type: 'success', text: '壁纸已删除' });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally {
            setBusy('');
        }
    };

    const isWallpaperActive = (id) => (
        settings.backgroundMode === 'wallpaper' && Number(settings.wallpaperId) === Number(id)
    );

    return (
        <section className="settings-theme-aware min-w-0 overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <ImagePlus className="h-4 w-4 text-indigo-500"/> Bing 与自定义壁纸
                    </h3>
                    <p className="mt-1 text-[10px] text-slate-400">
                        Bing 每日自动更新，或上传自己的图片。支持 JPG、PNG、WebP、AVIF，最大 12MB。
                    </p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden"
                        onChange={(event) => uploadWallpaper(event.target.files?.[0])}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={Boolean(busy)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-600 disabled:opacity-50"
                    >
                        {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}
                        上传并使用
                    </button>
                </div>
            </div>

            <LoadErrorNotice message={loadError} onRetry={loadWallpapers} />
            {message && (
                <div className={`mt-4 rounded-xl border px-4 py-3 text-xs font-medium ${
                    message.type === 'error'
                        ? 'border-red-100 bg-red-50 text-red-600'
                        : 'border-emerald-100 bg-emerald-50 text-emerald-700'
                }`}>
                    {message.text}
                </div>
            )}

            <div className="mt-5">
                <div className={`relative overflow-hidden rounded-2xl border-2 ${
                    isBingActive
                        ? 'border-indigo-500 shadow-md shadow-indigo-100'
                        : 'border-slate-100'
                }`}>
                    {latestBing ? (
                        <img
                            src={wallpaperContentUrl(latestBing.id, latestBing.content_hash)}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-indigo-700"/>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-950/75 via-slate-900/45 to-transparent"/>
                    <div className="relative flex min-h-40 flex-col justify-between p-5 text-white">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Cloud className="h-4 w-4"/>
                                <span className="text-[10px] font-bold uppercase tracking-wider">Bing 每日</span>
                            </div>
                            {isBingActive && (
                                <span className="rounded-full bg-white/20 px-2 py-1 text-[9px] font-bold backdrop-blur-md">
                                    自动更新中
                                </span>
                            )}
                        </div>
                        <div>
                            <div className="line-clamp-1 text-sm font-black">
                                {latestBing?.title || '获取今天的 Bing 壁纸'}
                            </div>
                            <div className="mt-1 text-[10px] text-white/70">
                                每天 09:15 自动同步并切换 · {latestBing?.source_date || '尚未同步'}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={enableBing}
                                    disabled={Boolean(busy)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[10px] font-bold text-slate-900 transition hover:bg-indigo-50 disabled:opacity-60"
                                >
                                    {busy === 'enable-bing' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Download className="h-3.5 w-3.5"/>}
                                    {isBingActive ? '正在使用' : '启用每日壁纸'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => syncBing()}
                                    disabled={Boolean(busy)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-[10px] font-bold text-white backdrop-blur-md transition hover:bg-white/25 disabled:opacity-60"
                                >
                                    {busy === 'sync-bing' ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <RefreshCw className="h-3.5 w-3.5"/>}
                                    立即同步
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
                <div>
                    <div className="text-xs font-black text-slate-800">壁纸图库</div>
                    <div className="mt-0.5 text-[9px] text-slate-400">Bing 历史与上传图片都会保存到 Cloudflare 对象存储</div>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-500">
                    {libraryWallpapers.length} 张
                </span>
            </div>

            {loading ? (
                <div className="mt-4 flex h-32 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-slate-400">
                    <Loader2 className="h-5 w-5 animate-spin"/>
                </div>
            ) : libraryWallpapers.length === 0 ? (
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 text-slate-400 transition hover:border-indigo-300 hover:bg-indigo-50/40 hover:text-indigo-500"
                >
                    <ImagePlus className="h-6 w-6"/>
                    <span className="mt-2 text-[10px] font-bold">还没有自定义壁纸，点击上传</span>
                </button>
            ) : (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {libraryWallpapers.map((wallpaper) => {
                        const active = isWallpaperActive(wallpaper.id);
                        return (
                            <div
                                key={wallpaper.id}
                                className={`group relative aspect-[16/10] overflow-hidden rounded-2xl border-2 bg-slate-100 text-left transition ${
                                    active ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-transparent hover:border-indigo-200'
                                }`}
                            >
                                <button
                                    type="button"
                                    onClick={() => selectWallpaper(wallpaper)}
                                    disabled={Boolean(busy)}
                                    className="absolute inset-0 h-full w-full text-left"
                                >
                                    <img
                                        src={wallpaperContentUrl(wallpaper.id, wallpaper.content_hash)}
                                        alt={wallpaper.title || '自定义壁纸'}
                                        loading="lazy"
                                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                                    />
                                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent px-3 pb-2.5 pt-8 text-white">
                                        <span className="block truncate text-[10px] font-bold">{wallpaper.title || '自定义壁纸'}</span>
                                        <span className="mt-0.5 block text-[8px] text-white/60">{formatBytes(wallpaper.byte_size)}</span>
                                    </span>
                                    {active && (
                                        <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-indigo-500 text-white shadow">
                                            <Check className="h-3.5 w-3.5"/>
                                        </span>
                                    )}
                                    <span className="absolute bottom-2 right-2 rounded-md bg-slate-950/55 px-1.5 py-1 text-[7px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                                        {wallpaper.source_type === 'bing' ? 'Bing' : '上传'}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    title="删除壁纸"
                                    onClick={(event) => removeWallpaper(event, wallpaper)}
                                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-slate-950/60 text-white opacity-0 backdrop-blur-sm transition hover:bg-red-500 group-hover:opacity-100 focus:opacity-100"
                                >
                                    {busy === `delete-${wallpaper.id}`
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                                        : <Trash2 className="h-3.5 w-3.5"/>}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default WallpaperManager;
