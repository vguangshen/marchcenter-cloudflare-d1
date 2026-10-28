let loaderPromise = null;

function loadAMapLoader() {
    if (typeof window === 'undefined') return Promise.reject(new Error('高德地图只能在浏览器中加载'));
    if (window.AMapLoader) return Promise.resolve(window.AMapLoader);
    if (loaderPromise) return loaderPromise;
    loaderPromise = new Promise((resolve, reject) => {
        let script = document.querySelector('script[data-marchcenter-amap-loader]');
        const loaded = () => window.AMapLoader ? resolve(window.AMapLoader) : reject(new Error('高德地图加载器未返回 AMapLoader'));
        const failed = () => reject(new Error('高德地图加载器加载失败'));
        if (!script) {
            script = document.createElement('script');
            script.src = 'https://webapi.amap.com/loader.js';
            script.async = true;
            script.dataset.marchcenterAmapLoader = 'true';
            script.addEventListener('load', loaded, { once: true });
            script.addEventListener('error', failed, { once: true });
            document.head.appendChild(script);
        } else {
            script.addEventListener('load', loaded, { once: true });
            script.addEventListener('error', failed, { once: true });
        }
    }).catch(error => {
        loaderPromise = null;
        document.querySelector('script[data-marchcenter-amap-loader]')?.remove();
        throw error;
    });
    return loaderPromise;
}

export async function loadAMap({ key, serviceHost } = {}) {
    const webKey = String(key || '').trim();
    if (!webKey) throw new Error('高德地图 Web Key 未配置');
    if (serviceHost) window._AMapSecurityConfig = { serviceHost };
    else delete window._AMapSecurityConfig;
    window.forbidenWebGL = true;
    const loader = await loadAMapLoader();
    return loader.load({ key: webKey, version: '2.0', plugins: [] });
}

export function loadAMapPlugins(amap, plugins = []) {
    const unique = [...new Set(plugins.filter(Boolean))];
    if (!unique.length || typeof amap?.plugin !== 'function') return Promise.resolve(amap);
    return new Promise((resolve, reject) => {
        try { amap.plugin(unique, () => resolve(amap)); }
        catch (error) { reject(error); }
    });
}
