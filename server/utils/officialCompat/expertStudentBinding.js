import { createOfficialSafeFetch } from './safeTransport.js';
import { validateConfirmedOfficialBaseUrl } from './officialJumpConfig.js';
import { buildJavaExpertJumpUrl } from './java/expertJump.js';
import { buildNetExpertJumpUrl } from './net/expertJump.js';

export function buildExpertStudentBindingUrl(method, baseUrl, config, expertName, studentAccountName) {
    if (method === 'java') {
        return buildJavaExpertJumpUrl(baseUrl, studentAccountName, expertName);
    }
    if (method === 'net') {
        return buildNetExpertJumpUrl(baseUrl, {
            serverConfig: config.expertServerConfig,
            expertName,
            userName: studentAccountName,
            entryMode: config.expertEntryMode,
            taskIds: config.expertTaskIds
        });
    }
    throw new Error('当前平台不支持评委学生关联');
}

export async function resolveNetExpertTicket({
    baseUrl,
    config,
    expertName,
    studentAccountName,
    fetchImplementation
}) {
    const base = new URL(validateConfirmedOfficialBaseUrl(baseUrl));
    const endpoint = new URL(`${base.pathname.replace(/\/$/, '')}/login.aspx`, base);
    endpoint.searchParams.set('op', 'loaduserscore');
    endpoint.searchParams.set('usernames', studentAccountName);
    endpoint.searchParams.set('expertname', expertName);
    const safeFetch = createOfficialSafeFetch({
        baseUrl,
        allowHttp: config.allowHttp === true,
        fetchImplementation
    });
    const response = await safeFetch(endpoint.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });
    const raw = await response.text();
    let result;
    try {
        result = JSON.parse(raw);
    } catch {
        const error = new Error('平台未返回有效的评委票据');
        error.status = 502;
        throw error;
    }
    let rows;
    try {
        rows = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    } catch {
        rows = null;
    }
    const row = Array.isArray(rows)
        ? rows.find(item => String(item?.username || '').trim() === studentAccountName)
        : null;
    if (!result.succ || !row?.data) {
        const error = new Error(`平台没有返回 ${studentAccountName} 的评委票据`);
        error.status = 502;
        throw error;
    }
    const login = new URL(`${base.pathname.replace(/\/$/, '')}/login.aspx`, base);
    login.searchParams.set('op', 'expertlogin');
    // The remote manager already URL-encodes this vendor ticket. Preserve it
    // verbatim instead of constructing a guessed evaluator payload locally.
    return `${login.toString()}&expertuserdata=${row.data}`;
}
