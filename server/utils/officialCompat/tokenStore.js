export const OFFICIAL_TOKEN_TTL_MS = 60 * 60 * 1000;
export const PAAS_V2_TOKEN_TTL_MS = 3 * OFFICIAL_TOKEN_TTL_MS;

/**
 * Request-independent cache container. Instantiate it in the composition layer;
 * this module intentionally has no mutable singleton state.
 */
export function createOfficialTokenStore(options = {}) {
    const now = options.now || Date.now;
    const ttlMs = options.ttlMs ?? OFFICIAL_TOKEN_TTL_MS;
    const maxEntries = options.maxEntries ?? Infinity;
    if (typeof now !== 'function') throw new TypeError('now 必须是函数');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs 必须是正数');
    if (maxEntries !== Infinity && (!Number.isSafeInteger(maxEntries) || maxEntries < 1)) {
        throw new TypeError('maxEntries 必须是正整数');
    }

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
            const normalizedKey = String(key);
            entries.delete(normalizedKey);
            if (value == null || value === '') return null;
            if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
            entries.set(normalizedKey, { value, expiresAt: now() + ttlMs });
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
