import { OfficialUrlBuildError } from './errors.js';

function requireString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialUrlBuildError(`${label}不能为空`);
    }
    return value;
}

/** Official `jump`: return the configured URL byte-for-byte unchanged. */
export function buildDirectJumpUrl(url) {
    return requireString(url, '跳转地址');
}

/**
 * Official SoftService JAVA rule. `resultData` is already the query fragment
 * returned by the adapter (normally `u=<UTF-8 encoded ticket>`).
 */
export function buildJavaJumpUrl(url, resultData) {
    const base = requireString(url, '平台地址');
    const data = requireString(resultData, 'JAVA 返回参数');
    return `${base}/open/enterIndex${base.includes('?') ? '&' : '?'}${data}`;
}

/**
 * Official teacher entry rule from the recovered TeacherController.
 *
 * `resultData` is the query fragment returned by
 * commonReturnTeacherBaseInfo (teacherUserName/className/classMode).  The
 * teacher endpoint carries the fixed needTheoryScore flag before that
 * fragment; neither the fragment nor the ticket is re-encoded here.
 */
export function buildJavaTeacherJumpUrl(url, resultData) {
    const base = requireString(url, '平台地址');
    const data = requireString(resultData, 'JAVA 教师返回参数');
    return `${base}/open/teacherIndex?needTheoryScore=1&${data}`;
}

/**
 * Official Axis-backed platform rule; the hexadecimal ticket is not encoded.
 * Teacher entry adds the fixed needTheoryScore flag used by the recovered
 * TeacherController for all SOAP-backed services.
 */
export function buildSoapJumpUrl(url, ticket, type = 'itmc', options = {}) {
    const base = requireString(url, '平台地址');
    const data = requireString(ticket, 'SOAP 登录票据');
    const ticketType = requireString(type, 'SOAP 票据类型');
    const teacherSuffix = options?.includeNeedTheoryScore === true
        ? '&needTheoryScore=1'
        : '';
    return `${base}/Login.aspx?type=${ticketType}&data=${data}${teacherSuffix}`;
}
