export const OFFICIAL_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Request-independent cache container. Instantiate it in the composition layer;
 * this module intentionally has no mutable singleton state.
 */
export function createOfficialTokenStore(options = {}) {
    const now = options.now || Date.now;
    const ttlMs = options.ttlMs ?? OFFICIAL_TOKEN_TTL_MS;
    if (typeof now !== 'function') throw new TypeError('now 必须是函数');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs 必须是正数');

    const entries = new Map();
    const get = key => {
        const normalizedKey = String(key);
        const entry = entries.get(normalizedKey);
        if (!entry) return null;
        if (entry.expiresAt <= now()) {
            entries.delete(normalizedKey);
            return null;
        }
        return entry.value;
    };
    return {
        get,
        set(key, value) {
            if (value == null || value === '') {
                entries.delete(String(key));
                return null;
            }
            entries.set(String(key), { value, expiresAt: now() + ttlMs });
            return value;
        },
        delete(key) {
            return entries.delete(String(key));
        },
        clear() {
            entries.clear();
        },
        has(key) {
            return get(key) !== null;
        }
    };
}
