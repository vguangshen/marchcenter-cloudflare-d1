import { OfficialResultParseError, OfficialResultShapeError } from './errors.js';

export const OFFICIAL_SUCCESS = 10000;
export const OFFICIAL_FAILURE = 10010;
export const OFFICIAL_TOKEN_EXPIRED = 10011;
export const OFFICIAL_RESULT_DATA_PRESENT = Symbol('officialResultDataPresent');

function rawText(value) {
    if (typeof value === 'string') return value;
    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === 'string' ? serialized : String(value);
    } catch {
        return String(value);
    }
}

function officialBoolean(value, raw) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new OfficialResultShapeError('Result.succ 必须是布尔值或布尔字符串', { raw });
}

export function isOfficialResult(value) {
    return Boolean(
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'code')
        && Object.prototype.hasOwnProperty.call(value, 'succ')
    );
}

/**
 * Normalize a confirmed Result object without treating unknown shapes as empty data.
 */
export function normalizeOfficialResult(value, raw = rawText(value)) {
    if (!isOfficialResult(value)) {
        throw new OfficialResultShapeError('返回对象不是官方 Result 结构', { raw });
    }

    const code = Number(value.code);
    if (!Number.isInteger(code)) {
        throw new OfficialResultShapeError('Result.code 必须是整数', { raw });
    }

    const dataPresent = value[OFFICIAL_RESULT_DATA_PRESENT]
        ?? Object.prototype.hasOwnProperty.call(value, 'data');
    const normalized = {
        code,
        succ: officialBoolean(value.succ, raw),
        message: value.message == null ? '' : String(value.message),
        data: value.data === undefined ? null : value.data,
        raw
    };
    Object.defineProperty(normalized, OFFICIAL_RESULT_DATA_PRESENT, {
        value: dataPresent,
        enumerable: false,
        configurable: false,
        writable: false
    });
    return normalized;
}

export function hasOfficialResultData(value) {
    if (!value || typeof value !== 'object') return false;
    return value[OFFICIAL_RESULT_DATA_PRESENT]
        ?? Object.prototype.hasOwnProperty.call(value, 'data');
}

/**
 * Decode an official JSON Result. Empty, malformed, null, arrays and unrelated
 * objects are deliberately distinct failures and are never converted to [].
 */
export function decodeOfficialResult(raw) {
    if (typeof raw !== 'string') {
        return normalizeOfficialResult(raw, rawText(raw));
    }
    if (raw.length === 0) {
        throw new OfficialResultParseError('官方响应为空字符串', { raw });
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (cause) {
        throw new OfficialResultParseError('官方响应不是有效 JSON', { raw, cause });
    }
    return normalizeOfficialResult(parsed, raw);
}

/**
 * TrainingEntrance wraps every non-Result return, including null, as success.
 */
export function wrapTrainingEntranceReturn(value) {
    if (isOfficialResult(value)) return normalizeOfficialResult(value);
    return {
        code: OFFICIAL_SUCCESS,
        succ: true,
        message: '成功',
        data: value,
        raw: rawText(value)
    };
}

export function isTokenExpiredResult(value) {
    return isOfficialResult(value) && Number(value.code) === OFFICIAL_TOKEN_EXPIRED;
}
