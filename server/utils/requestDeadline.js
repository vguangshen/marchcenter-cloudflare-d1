export function createRequestDeadline(timeoutMs, externalSignal, reason = new DOMException('请求超时', 'TimeoutError')) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(reason), timeoutMs);
    return {
        signal: controller.signal,
        cancel: cause => controller.abort(cause),
        dispose() {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', forwardAbort);
        }
    };
}

// Used for I/O whose API has no AbortSignal parameter. The caller owns cleanup.
export async function waitForSignal(operation, signal) {
    if (!signal) return operation();
    signal.throwIfAborted();
    let abort;
    const canceled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation(), canceled]); }
    finally { signal.removeEventListener('abort', abort); }
}
