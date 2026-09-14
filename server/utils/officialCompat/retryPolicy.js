import { isTokenExpiredResult, wrapTrainingEntranceReturn } from './resultCodec.js';

export const OFFICIAL_MAX_METHOD_ATTEMPTS = 3;

/**
 * Reproduce TrainingEntrance's method-level token-expiration loop.
 * Exceptions escape immediately; only a returned Result(code=10011) retries.
 */
export async function executeWithOfficialRetry(invoke, options = {}) {
    if (typeof invoke !== 'function') throw new TypeError('invoke 必须是函数');
    const clearToken = options.clearToken || (() => undefined);
    if (typeof clearToken !== 'function') throw new TypeError('clearToken 必须是函数');

    for (let attempt = 1; attempt <= OFFICIAL_MAX_METHOD_ATTEMPTS; attempt += 1) {
        const returned = await invoke(attempt);
        if (!isTokenExpiredResult(returned)) return wrapTrainingEntranceReturn(returned);
        await clearToken(attempt, returned);
    }
    return null;
}

