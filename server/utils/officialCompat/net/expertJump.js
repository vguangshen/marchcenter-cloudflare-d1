import { validateConfirmedOfficialBaseUrl } from '../officialJumpConfig.js';

const EXPERT_NAME_PATTERN = /^[^\u0000-\u001f\u007f=]{2,64}$/u;
const ENTRY_MODES = new Set(['legacy', 'open']);

function requireText(value, label, { maxLength = 128 } = {}) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new Error(`${label}不符合原版评委入口格式`);
    }
    return normalized;
}

export function normalizeNetExpertName(value, fallback) {
    const expertName = String(value ?? fallback ?? '').trim();
    if (!EXPERT_NAME_PATTERN.test(expertName)) {
        throw new Error('评委账号长度需为 2–64 位，且不能包含等号或控制字符');
    }
    return expertName;
}

/**
 * The recovered .NET competition manager passes evaluator data as JSON. The
 * key order is kept identical to the original sample so this helper can be
 * compared directly with captured vendor URLs.
 */
export function buildNetExpertPayload({
    serverConfig = 'itmc',
    expertName,
    userName
} = {}) {
    return JSON.stringify({
        ServerConfig: requireText(serverConfig, 'ServerConfig'),
        ExpertName: normalizeNetExpertName(expertName),
        UserName: requireText(userName, '用户账号')
    });
}

/**
 * `legacy` is the original .NET/e-commerce compatibility route. `open` is
 * retained for newer deployments whose evaluator page follows the Java-style
 * entry path; taskIds is included only when the deployment explicitly gives
 * one, because the original manager treats it as an optional value.
 */
export function buildNetExpertJumpUrl(baseUrl, {
    serverConfig,
    expertName,
    userName,
    entryMode = 'legacy',
    taskIds
} = {}) {
    const base = validateConfirmedOfficialBaseUrl(baseUrl);
    if (!ENTRY_MODES.has(entryMode)) {
        throw new Error('评委入口模式只支持 legacy 或 open');
    }

    const payload = encodeURIComponent(buildNetExpertPayload({
        serverConfig,
        expertName,
        userName
    }));
    if (entryMode === 'legacy') {
        return `${base}/login.aspx?op=expertlogin&expertuserdata=${payload}`;
    }

    const normalizedTaskIds = taskIds === undefined || taskIds === null || taskIds === ''
        ? ''
        : requireText(taskIds, 'taskIds');
    const taskQuery = normalizedTaskIds ? `taskIds=${encodeURIComponent(normalizedTaskIds)}&` : '';
    return `${base}/open/toExpertPage?${taskQuery}expertuserdata=${payload}`;
}
