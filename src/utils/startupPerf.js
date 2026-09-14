// 登录首屏时序测量（非生产调试）。
// 激活条件：开发模式（import.meta.env.DEV）或 URL 带 ?marchcenter-perf=1。
// 生产默认关闭；需要真机/生产节点测量时手动带参数访问即可，不污染常规用户。
// 输出到 console.info，不改变任何渲染行为。

const PERF_PARAM = 'marchcenter-perf';

const isEnabled = () => {
    if (import.meta.env?.DEV) return true;
    try {
        return new URLSearchParams(window.location.search).has(PERF_PARAM);
    } catch {
        return false;
    }
};

export const perfActive = typeof window !== 'undefined' && isEnabled();

export function mark(name) {
    if (!perfActive || typeof performance === 'undefined') return;
    try { performance.mark(name); } catch { /* mark 已存在时忽略 */ }
}

export function measure(name, startMark, endMarkOrTime) {
    if (!perfActive || typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
    try { performance.measure(name, startMark, endMarkOrTime); } catch { /* 起点/终点缺失时忽略 */ }
}

function markTime(name) {
    const entries = performance.getEntriesByName(name);
    return entries.length ? entries[entries.length - 1].startTime : null;
}

function format(ms) {
    return ms == null ? '—' : `${ms.toFixed(1)}ms`;
}

/**
 * 汇总登录首屏各阶段耗时并输出。
 * 覆盖：navigationStart、HTML responseStart、DOMContentLoaded、
 * 主 JS 下载完成、React 开始执行、React root mount、LoginPage 首次渲染、
 * setup-status / site config 请求区间、壁纸开始/首字节/完成。
 */
export function logStartupPerfSummary() {
    if (!perfActive) return;
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');

    // 主 JS 入口：取最早开始的 .js 资源（生产为 /assets/index-*.js）。
    const scripts = resources
        .filter(entry => /\.js$/.test(entry.name))
        .sort((a, b) => a.startTime - b.startTime);
    const entryScript = scripts[0];

    const phases = [
        ['navigationStart', 0],
        ['HTML responseStart', nav?.responseStart ?? null],
        ['DOMContentLoaded', nav?.domContentLoadedEventStart ?? null],
        ['主 JS 下载完成', entryScript ? entryScript.responseEnd : null],
        ['React 开始执行', markTime('reactStart')],
        ['React root mount', markTime('reactRootMounted')],
        ['LoginPage 首次渲染', markTime('loginPageFirstRender')],
        ['setup-status 开始', markTime('setupStatusRequestStart')],
        ['setup-status 结束', markTime('setupStatusRequestEnd')],
        ['/api/config/site 开始', markTime('siteConfigRequestStart')],
        ['/api/config/site 结束', markTime('siteConfigRequestEnd')],
        ['壁纸请求开始', markTime('wallpaperRequestStart')],
        ['壁纸首字节', markTime('wallpaperFirstByte')],
        ['壁纸加载完成', markTime('wallpaperLoadComplete')]
    ];
    const summary = phases
        .map(([label, value]) => `  ${label}: ${format(value)}`)
        .join('\n');
    console.info(`[marchcenter-perf] 登录首屏时序（相对 navigationStart）\n${summary}`);
}

/** 从已完成的图片资源中记录首字节与完成时刻（浏览器资源时序 API）。 */
export function recordImageResourceTiming(url) {
    if (!perfActive || !url) return;
    const entries = performance.getEntriesByName(String(url));
    const timing = entries[entries.length - 1];
    if (!timing) return;
    if (Number.isFinite(timing.responseStart)) {
        try { performance.measure('wallpaperFirstByte', 'wallpaperRequestStart', timing.responseStart); } catch { /* 忽略 */ }
    }
    if (Number.isFinite(timing.responseEnd)) {
        try { performance.measure('wallpaperComplete', 'wallpaperRequestStart', timing.responseEnd); } catch { /* 忽略 */ }
    }
    mark('wallpaperFirstByte');
    mark('wallpaperLoadComplete');
}
