export const MAX_COVER_BYTES = 5 * 1024 * 1024;

// R2 operations do not accept an AbortSignal; stop waiting when the batch ends.
export async function waitForCoverOperation(operation, signal) {
    if (signal?.aborted) throw signal.reason;
    if (!signal) return operation();
    let abort;
    const canceled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation(), canceled]); }
    finally { signal.removeEventListener('abort', abort); }
}

/** Read at most the cover budget and cancel upstream before retaining extra chunks. */
export async function readLimitedCover(response, signal) {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_BYTES) {
        void response.body?.cancel().catch(() => {});
        return null;
    }
    if (!response.body) return null;
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let total = 0;
    const chunks = [];
    try {
        while (true) {
            if (signal.aborted) { cancel(); throw signal.reason; }
            const { value, done } = await reader.read();
            if (signal.aborted) throw signal.reason;
            if (done) break;
            total += value.byteLength;
            if (total > MAX_COVER_BYTES) {
                void reader.cancel().catch(() => {});
                return null;
            }
            chunks.push(value);
        }
        if (!total) return null;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
        return result.buffer;
    } finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}
