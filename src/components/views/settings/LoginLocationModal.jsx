import React, { useEffect, useState } from 'react';
import { MapPin, X, Loader2, Globe, Clock, Building2, LocateFixed, ExternalLink } from 'lucide-react';
import { api } from '../../../utils/api';

// 高德地图 URI：无需 API key，跳转到地图按坐标打点（国内可访问）。
// Cloudflare 提供的是 WGS-84 坐标，coordinate=wgs84 让高德服务端转换为
// GCJ-02 再打点，避免偏移；position 参数顺序为「经度,纬度」。
const amapUrl = (lat, lng, label) => {
    const params = new URLSearchParams({
        position: `${lng},${lat}`,
        name: label || '',
        coordinate: 'wgs84'
    });
    return `https://uri.amap.com/marker?${params.toString()}`;
};

const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('zh-CN', { hour12: false });
};

const countryName = (code) => {
    if (!code) return '';
    try {
        return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || code;
    } catch {
        return code;
    }
};

const locationLabel = (loc) => {
    if (!loc) return '未知位置';
    const parts = [];
    if (loc.city) parts.push(loc.city);
    if (loc.region) parts.push(loc.region);
    if (loc.country_code) parts.push(countryName(loc.country_code));
    if (parts.length) return parts.join(' · ');
    return loc.latitude != null && loc.longitude != null
        ? `${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(4)}`
        : '未知位置';
};

const DetailRow = ({ icon: Icon, label, value }) => (
    value ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="shrink-0 text-slate-400">{label}</span>
            <span className="min-w-0 truncate font-medium">{value}</span>
        </div>
    ) : null
);

const LoginLocationModal = ({ user, onClose }) => {
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError('');
        api.get(`/users/${user.id}/locations`, { fallback: '登录位置读取失败' })
            .then((data) => {
                if (cancelled) return;
                const list = Array.isArray(data.locations) ? data.locations : [];
                setLocations(list);
                setSelected(list.find((item) => item.latitude != null && item.longitude != null) || null);
            })
            .catch((error) => { if (!cancelled) setLoadError(error.message || '登录位置读取失败'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [user.id]);

    // 历史为空时兜底用用户列表里的最新位置。
    const latestFromUser = (user.last_latitude != null && user.last_longitude != null)
        ? {
            latitude: user.last_latitude, longitude: user.last_longitude,
            city: user.last_city, region: user.last_region, country_code: user.last_country_code,
            timezone: user.last_timezone, organization: user.last_organization, ip: user.last_login_ip
        }
        : null;
    const active = selected || latestFromUser;
    const hasCoordinates = active && active.latitude != null && active.longitude != null;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center px-4"
            onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="location-modal-title"
                className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <h2 id="location-modal-title" className="flex items-center gap-2 text-base font-black text-slate-800 dark:text-white">
                        <MapPin className="h-4 w-4 text-indigo-500" /> {user.username} 的登录位置
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label="关闭"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-5">
                    {loading ? (
                        <div className="flex h-48 items-center justify-center text-slate-400">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    ) : hasCoordinates ? (
                        <>
                            <div className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                                <iframe
                                    title={`${user.username} 登录位置地图`}
                                    src={amapUrl(Number(active.latitude), Number(active.longitude), locationLabel(active))}
                                    className="h-64 w-full"
                                    loading="lazy"
                                />
                                <a
                                    href={amapUrl(Number(active.latitude), Number(active.longitude), locationLabel(active))}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white dark:bg-slate-800/90 dark:text-slate-300"
                                    title="在新窗口打开高德地图"
                                >
                                    <ExternalLink className="h-3 w-3" /> 新窗口
                                </a>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px]">
                                <span className="flex items-center gap-1 font-bold text-slate-600 dark:text-slate-300">
                                    <MapPin className="h-3 w-3 text-indigo-500" /> {locationLabel(active)}
                                </span>
                                <span className="font-mono text-slate-400">
                                    {Number(active.latitude).toFixed(4)}, {Number(active.longitude).toFixed(4)}
                                </span>
                            </div>
                        </>
                    ) : (
                        <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800/50">
                            <LocateFixed className="mr-2 h-5 w-5" /> 暂无可用坐标（IP 无法定位或本地开发）
                        </div>
                    )}

                    {active && (
                        <div className="mt-3 grid grid-cols-2 gap-1.5">
                            <DetailRow icon={Globe} label="IP" value={active.ip} />
                            <DetailRow icon={Globe} label="时区" value={active.timezone} />
                            <DetailRow icon={Building2} label="运营商" value={active.organization} />
                            <DetailRow icon={Clock} label="最近登录" value={active.created_at ? formatTime(active.created_at) : undefined} />
                        </div>
                    )}

                    <div className="mt-4">
                        <div className="mb-2 text-xs font-bold text-slate-500">登录位置历史（{locations.length}）</div>
                        {locations.length === 0 ? (
                            <div className="text-xs text-slate-400">暂无历史记录</div>
                        ) : (
                            <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                                {locations.map((item) => {
                                    const clickable = item.latitude != null && item.longitude != null;
                                    const isActive = active && active.id === item.id;
                                    return (
                                        <li key={item.id}>
                                            <button
                                                type="button"
                                                disabled={!clickable}
                                                onClick={() => setSelected(item)}
                                                className={`w-full px-2 py-2 text-left text-xs transition-colors ${
                                                    isActive ? 'bg-indigo-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-slate-700 dark:text-slate-200">{locationLabel(item)}</span>
                                                    {item.ip && <span className="ml-auto font-mono text-slate-400">{item.ip}</span>}
                                                </div>
                                                <div className="mt-0.5 text-[10px] text-slate-400">
                                                    {formatTime(item.created_at)}{item.organization ? ` · ${item.organization}` : ''}
                                                </div>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    {loadError && <div className="mt-3 text-xs text-red-500">{loadError}</div>}
                </div>
            </section>
        </div>
    );
};

export default LoginLocationModal;
