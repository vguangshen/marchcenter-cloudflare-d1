export const createLastSeenWriteTracker = ({
    writeIntervalMs = 60_000,
    entryTtlMs = 10 * 60_000,
    pruneIntervalMs = 5 * 60_000,
    maxEntries = 5_000
} = {}) => {
    const entries = new Map();
    let lastPrunedAt = 0;

    const prune = (now) => {
        if (now - lastPrunedAt < pruneIntervalMs && entries.size <= maxEntries) return;
        lastPrunedAt = now;
        const expiresBefore = now - entryTtlMs;
        for (const [userId, writtenAt] of entries) {
            if (writtenAt < expiresBefore) entries.delete(userId);
        }
        if (entries.size <= maxEntries) return;
        const overflow = entries.size - maxEntries;
        let removed = 0;
        for (const userId of entries.keys()) {
            entries.delete(userId);
            removed += 1;
            if (removed >= overflow) break;
        }
    };

    return {
        shouldWrite(userId, now = Date.now()) {
            prune(now);
            const previousWrite = entries.get(userId) || 0;
            if (now - previousWrite < writeIntervalMs) return false;
            entries.delete(userId);
            entries.set(userId, now);
            prune(now);
            return true;
        },
        size() {
            return entries.size;
        }
    };
};
