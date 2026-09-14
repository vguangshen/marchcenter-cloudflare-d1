import { AsyncLocalStorage } from 'node:async_hooks';

const runtimeStorage = new AsyncLocalStorage();

/**
 * Run a request/scheduled callback with the Cloudflare runtime context.
 *
 * `services` is intentionally explicit: request-independent services (for
 * example the best-effort official token cache) are created by the Worker
 * composition root and passed through the runtime context rather than being
 * hidden in a module singleton inside a route.
 */
export function runWithRuntime(env, ctx, callback, services = {}) {
    return runtimeStorage.run({ env, ctx, ...services }, callback);
}

export function getRuntime() {
    const current = runtimeStorage.getStore();
    if (!current?.env) throw new Error('Cloudflare runtime environment is unavailable');
    return current;
}

export function getEnv(name, fallback = '') {
    const runtimeValue = runtimeStorage.getStore()?.env?.[name];
    if (runtimeValue != null) return runtimeValue;
    const processValue = globalThis.process?.env?.[name];
    return processValue == null ? fallback : processValue;
}

export function waitUntil(promise) {
    const ctx = runtimeStorage.getStore()?.ctx;
    if (ctx?.waitUntil) ctx.waitUntil(Promise.resolve(promise));
}
