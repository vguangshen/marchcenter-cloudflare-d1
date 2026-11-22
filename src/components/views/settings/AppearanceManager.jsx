import React from 'react';
import {
    Check, Cloud, Moon, Palette, PartyPopper,
    Snowflake, Sparkles, Sun, SunMoon, Ghost, Ship, CircleDot, Umbrella,
    MonitorPlay, LayoutDashboard, PanelTop, Image
} from 'lucide-react';
import { DEFAULT_SYSTEM_EFFECTS } from '../../../constants/themes';
import { DEFAULT_SCENE_WALLPAPERS } from '../../../constants/defaultSceneWallpapers';
import { IMMERSIVE_WALLPAPERS } from '../../../constants/immersiveWallpapers';
import WallpaperManager from './WallpaperManager';
import ThemeCarousel from './ThemeCarousel';

const EFFECT_MODES = [
    {
        id: 'default',
        icon: Sparkles,
        label: '默认效果',
        desc: '静态竞赛场景',
        accent: 'from-indigo-500 to-slate-800'
    },
    {
        id: 'immersive',
        icon: PartyPopper,
        label: '沉浸式节日场景',
        desc: '选择一个节日氛围',
        accent: 'from-fuchsia-500 to-purple-600'
    },
    {
        id: 'wallpaper',
        icon: Cloud,
        label: 'Bing 壁纸引擎',
        desc: '每日壁纸与手动上传',
        accent: 'from-sky-500 to-cyan-500'
    },
    {
        id: 'color',
        icon: Palette,
        label: '手动选择主色调',
        desc: '滑动切换竞赛主题',
        accent: 'from-amber-400 to-rose-500'
    }
];

const IMMERSIVE_OPTIONS = [
    { id: 'christmas', icon: Snowflake, label: '圣诞雪夜', desc: '物理积雪', color: 'red' },
    { id: 'lunar_new_year', icon: PartyPopper, label: '农历新年', desc: '烟花灯笼', color: 'orange' },
    { id: 'halloween', icon: Ghost, label: '万圣前夜', desc: '幽灵蝙蝠', color: 'purple' },
    { id: 'mid_autumn', icon: Moon, label: '中秋佳节', desc: '明月孔明灯', color: 'blue' },
    { id: 'dragon_boat', icon: Ship, label: '端午安康', desc: '龙舟粽子', color: 'teal' },
    { id: 'yuanxiao', icon: CircleDot, label: '闹元宵', desc: '汤圆灯谜', color: 'pink' },
    { id: 'qingming', icon: Umbrella, label: '清明雨上', desc: '烟雨纸鸢', color: 'gray' }
];

const DEFAULT_SCENE_PREVIEWS = [
    { mode: 'light', label: '晨光', icon: Sun },
    { mode: 'dark', label: '夜赛', icon: Moon }
];

const SYSTEM_EFFECT_OPTIONS = [
    {
        key: 'loginVisualFloat',
        icon: MonitorPlay,
        label: '登录页图形浮动',
        desc: '控制登录插画中央图形的缓慢悬浮'
    },
    {
        key: 'loginEntrance',
        icon: PanelTop,
        label: '登录窗口入场过渡',
        desc: '控制登录卡片出现与登录成功离场动画'
    },
    {
        key: 'dashboardCardReveal',
        icon: LayoutDashboard,
        label: '首页卡片加载动画',
        desc: '控制加载呼吸、分组和卡片依次入场'
    },
    {
        key: 'wallpaperReveal',
        icon: Image,
        label: '壁纸景深过渡',
        desc: '控制登录后壁纸由深度模糊平滑过渡到主页轻柔焦'
    }
];

const AppearanceManager = ({ settings, onSave, token, effectiveLightDark }) => {
    const effectMode = settings.effectMode || 'default';
    const systemEffects = {
        ...DEFAULT_SYSTEM_EFFECTS,
        ...(settings.systemEffects || {})
    };

    const updateSettings = (patch) => onSave(patch);

    const selectEffectMode = (mode) => {
        if (mode === 'default') {
            updateSettings({
                effectMode: 'default',
                immersive: null,
                backgroundMode: 'default',
                wallpaperId: null,
                themeAccent: null
            });
            return;
        }
        if (mode === 'immersive') {
            const currentScene = IMMERSIVE_OPTIONS.some(item => item.id === settings.immersive)
                ? settings.immersive
                : 'christmas';
            updateSettings({
                effectMode: 'immersive',
                immersive: currentScene,
                backgroundMode: 'default',
                wallpaperId: null,
                themeAccent: null
            });
            return;
        }
        if (mode === 'wallpaper') {
            updateSettings({
                effectMode: 'wallpaper',
                immersive: null,
                backgroundMode: ['bing', 'wallpaper'].includes(settings.backgroundMode)
                    ? settings.backgroundMode
                    : 'bing'
            });
            return;
        }
        updateSettings({
            effectMode: 'color',
            immersive: null,
            backgroundMode: 'default',
            wallpaperId: null,
            themeAccent: null
        });
    };

    const toggleSystemEffect = (key) => {
        updateSettings({
            systemEffects: {
                [key]: systemEffects[key] === false
            }
        });
    };

    return (
        <div className="settings-theme-aware min-w-0 max-w-full space-y-8 animate-in fade-in duration-500 pb-10">
            <section className="min-w-0 overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <Sparkles className="h-4 w-4 text-indigo-500"/> 背景效果
                    </h3>
                    <p className="mt-1 text-[10px] text-slate-400">四种效果互相独立，切换后只展开当前模式的设置</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {EFFECT_MODES.map((mode) => {
                        const active = effectMode === mode.id;
                        return (
                            <button
                                key={mode.id}
                                type="button"
                                onClick={() => selectEffectMode(mode.id)}
                                aria-pressed={active}
                                className={`group relative min-h-32 overflow-hidden rounded-2xl border-2 p-4 text-left transition ${
                                    active
                                        ? 'border-indigo-500 bg-indigo-50/70 shadow-lg shadow-indigo-100'
                                        : 'border-slate-100 bg-white hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md'
                                }`}
                            >
                                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${mode.accent} ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}/>
                                <div className="flex items-start justify-between gap-3">
                                    <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${mode.accent} text-white shadow-sm`}>
                                        <mode.icon className="h-5 w-5"/>
                                    </span>
                                    {active && (
                                        <span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-500 text-white">
                                            <Check className="h-3.5 w-3.5"/>
                                        </span>
                                    )}
                                </div>
                                <div className="mt-4 text-xs font-black text-slate-800">{mode.label}</div>
                                <div className="mt-1 text-[10px] text-slate-400">{mode.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </section>

            {effectMode === 'default' && (
                <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] lg:items-center">
                        <div>
                            <h3 className="text-lg font-black text-slate-900">赛场天际线</h3>
                            <p className="mt-2 max-w-xl text-xs leading-6 text-slate-500">
                                赛道通向远处的竞赛场馆。登录页和主页会随明暗模式切换，分别呈现晨光与夜赛。
                            </p>
                        </div>
                        <div className="grid min-w-0 grid-cols-2 gap-2">
                            {DEFAULT_SCENE_PREVIEWS.map(({ mode, label, icon: Icon }) => {
                                const active = effectiveLightDark === mode;
                                return (
                                    <figure
                                        key={mode}
                                        aria-current={active || undefined}
                                        className={`min-w-0 overflow-hidden rounded-xl border bg-slate-50 ${active ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-slate-200'}`}
                                    >
                                        <img
                                            src={DEFAULT_SCENE_WALLPAPERS[mode]}
                                            alt=""
                                            loading="lazy"
                                            decoding="async"
                                            className="aspect-video w-full object-cover"
                                        />
                                        <figcaption className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-bold text-slate-600">
                                            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true"/>
                                            {label}
                                        </figcaption>
                                    </figure>
                                );
                            })}
                        </div>
                    </div>
                </section>
            )}

            {effectMode === 'immersive' && (
                <section className="relative overflow-hidden rounded-3xl bg-slate-900 p-6 shadow-xl shadow-slate-200 animate-in fade-in slide-in-from-top-2">
                    <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-[100px]"/>
                    <h3 className="relative z-10 mb-5 flex items-center gap-2 text-sm font-bold text-white">
                        <PartyPopper className="h-4 w-4 text-yellow-400"/> 选择节日场景
                    </h3>
                    <div className="relative z-10 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {IMMERSIVE_OPTIONS.map((item) => {
                            const active = settings.immersive === item.id;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => updateSettings({ immersive: item.id })}
                                    aria-pressed={active}
                                    className={`group relative isolate overflow-hidden rounded-xl border bg-slate-800 p-3 text-left transition ${
                                        active
                                            ? 'border-white text-white shadow-lg'
                                            : 'border-white/20 text-slate-200 hover:border-white/60'
                                    }`}
                                >
                                    <img
                                        src={IMMERSIVE_WALLPAPERS[item.id]}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-[center_68%]"
                                    />
                                    <span className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-slate-950/50 to-slate-950/85" aria-hidden="true"/>
                                    <div className="flex items-center justify-between">
                                        <item.icon className="h-5 w-5"/>
                                        {active && <span className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.8)]"/>}
                                    </div>
                                    <div className="mt-3 text-xs font-bold text-slate-100">{item.label}</div>
                                    <div className="mt-0.5 text-[10px] text-slate-200">{item.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            {effectMode === 'wallpaper' && (
                <WallpaperManager settings={settings} onSave={onSave} token={token}/>
            )}

            {effectMode === 'color' && (
                <ThemeCarousel
                    value={settings.manualColor}
                    dark={effectiveLightDark === 'dark'}
                    onChange={manualColor => onSave({ manualColor }, { requiredMode: 'color' })}
                />
            )}

            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2.5 ${
                        settings.lightDark === 'dark'
                            ? 'bg-slate-800 text-yellow-400'
                            : settings.lightDark === 'auto'
                                ? 'bg-indigo-100 text-indigo-600'
                                : 'bg-white text-orange-500 shadow-sm'
                    }`}>
                        {settings.lightDark === 'auto'
                            ? <SunMoon className="h-5 w-5"/>
                            : settings.lightDark === 'dark' ? <Moon className="h-5 w-5"/> : <Sun className="h-5 w-5"/>}
                    </div>
                    <div>
                        <div className="text-sm font-bold text-slate-800">明暗模式</div>
                        <div className="text-[10px] text-slate-500">
                            当前：{settings.lightDark === 'auto'
                                ? `自动 · 当前${effectiveLightDark === 'dark' ? '夜间' : '日间'}（北京）`
                                : settings.lightDark === 'dark' ? '深色模式' : '浅色模式'}
                        </div>
                    </div>
                </div>
                <div className="flex rounded-xl bg-slate-200/50 p-1">
                    <button
                        type="button"
                        onClick={() => updateSettings({ lightDark: 'auto' })}
                        title="根据日出日落自动切换日间/夜间模式"
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                            settings.lightDark === 'auto'
                                ? 'bg-indigo-500 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        自动
                    </button>
                    <button
                        type="button"
                        onClick={() => updateSettings({ lightDark: 'light' })}
                        className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${settings.lightDark === 'light' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Light
                    </button>
                    <button
                        type="button"
                        onClick={() => updateSettings({ lightDark: 'dark' })}
                        className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${settings.lightDark === 'dark' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Dark
                    </button>
                </div>
            </div>

            <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                        <MonitorPlay className="h-4 w-4 text-indigo-500"/> 系统效果组件
                    </h3>
                    <p className="mt-1 text-[10px] text-slate-400">按需关闭页面中的非必要动态效果，功能与数据加载不受影响</p>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {SYSTEM_EFFECT_OPTIONS.map((item) => {
                        const enabled = systemEffects[item.key] !== false;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => toggleSystemEffect(item.key)}
                                aria-pressed={enabled}
                                className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${
                                    enabled
                                        ? 'border-indigo-100 bg-indigo-50/50'
                                        : 'border-slate-200 bg-slate-50'
                                }`}
                            >
                                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                                    enabled ? 'bg-white text-indigo-600 shadow-sm' : 'bg-slate-200/70 text-slate-400'
                                }`}>
                                    <item.icon className="h-5 w-5"/>
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-black text-slate-800">{item.label}</span>
                                    <span className="mt-1 block text-[10px] leading-4 text-slate-400">{item.desc}</span>
                                </span>
                                <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                                    enabled ? 'bg-indigo-500' : 'bg-slate-300'
                                }`}>
                                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                                        enabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}/>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};

export default AppearanceManager;
