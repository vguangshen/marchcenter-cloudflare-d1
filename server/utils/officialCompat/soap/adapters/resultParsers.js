import { OfficialResponseParseError } from '../../errors.js';
import {
    decodeOfficialResult,
    hasOfficialResultData,
    normalizeOfficialResult,
    OFFICIAL_SUCCESS
} from '../../resultCodec.js';
import { sanitizeSoapRaw } from '../responseParser.js';

export const BUSINESS_RESPONSE_EVIDENCE = Object.freeze({
    IsGroupExisted: 'official-captured',
    IsStuExisted: 'official-captured',
    IsTeacherExisted: 'official-captured',
    AddTrainGroup: 'official-captured',
    AddAppraisalGroup: 'official-captured',
    AddMegagameGroup: 'official-captured',
    AddGroup: 'official-static-derived',
    AddStudent: 'official-captured',
    AddTeacher: 'official-captured'
});

function rawText(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function sanitizeOperationRaw(value) {
    return sanitizeSoapRaw(rawText(value))
        .replace(/("(?:password|token|authorization)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');
}

function dataKind(data) {
    if (data === null) return 'null';
    if (Array.isArray(data)) return 'array';
    return typeof data;
}

function parseResult(operationName, value) {
    let result;
    try {
        result = typeof value === 'string'
            ? decodeOfficialResult(value)
            : normalizeOfficialResult(value, rawText(value));
    } catch (cause) {
        throw new OfficialResponseParseError(`${operationName} 返回值不是有效 Result`, {
            operationName,
            raw: sanitizeOperationRaw(value),
            cause
        });
    }
    if (!hasOfficialResultData(result)) {
        throw new OfficialResponseParseError(`${operationName} Result 缺少 data 字段`, {
            operationName,
            dataKind: 'missing',
            raw: sanitizeOperationRaw(value)
        });
    }
    if (result.code !== OFFICIAL_SUCCESS) return { status: 'failure', result };
    return { status: 'success', result };
}

function throwDataShape(operationName, result, expected) {
    throw new OfficialResponseParseError(`${operationName} data 必须是${expected}`, {
        operationName,
        dataKind: dataKind(result.data),
        raw: sanitizeOperationRaw(result.raw ?? result)
    });
}

function validateStringArray(operationName, result) {
    let values = result.data;
    if (typeof values === 'string') {
        try {
            values = JSON.parse(values);
        } catch (cause) {
            throw new OfficialResponseParseError(`${operationName} data 不是有效 JSON 字符串数组`, {
                operationName,
                dataKind: 'invalid-json-string',
                raw: sanitizeOperationRaw(result.raw ?? result),
                cause
            });
        }
    }
    if (!Array.isArray(values)) throwDataShape(operationName, result, '数组或其 JSON 字符串');
    // Fastjson JSON.parseArray(data, String.class) coerces non-string items.
    return values.map(value => {
        if (value === null) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    });
}

export function parseGroupExistence(value) {
    const parsed = parseResult('IsGroupExisted', value);
    const { data } = parsed.result;
    if (data === null) return { ...parsed, exists: false, groupID: null };
    if (typeof data !== 'string') throwDataShape('IsGroupExisted', parsed.result, '字符串或 null');
    return { ...parsed, exists: data.length > 0, groupID: data };
}

export function parseAccountExistence(operationName, value) {
    if (operationName !== 'IsStuExisted' && operationName !== 'IsTeacherExisted') {
        throw new TypeError(`不支持的存在性操作 ${operationName}`);
    }
    const parsed = parseResult(operationName, value);
    if (parsed.status === 'failure') return parsed;
    if (parsed.result.data === null) throwDataShape(operationName, parsed.result, '字符串数组或其 JSON 字符串');
    return { ...parsed, accounts: validateStringArray(operationName, parsed.result) };
}

export function parseGroupMutation(operationName, value) {
    if (!['AddTrainGroup', 'AddAppraisalGroup', 'AddMegagameGroup', 'AddGroup'].includes(operationName)) {
        throw new TypeError(`不支持的建班操作 ${operationName}`);
    }
    const parsed = parseResult(operationName, value);
    if (parsed.status === 'failure') return parsed;
    if (parsed.result.data === null) throwDataShape(operationName, parsed.result, '班级 ID 字符串或对象');
    if (typeof parsed.result.data === 'string') return { ...parsed, groupID: parsed.result.data };
    if (typeof parsed.result.data === 'object' && !Array.isArray(parsed.result.data)) {
        return { ...parsed, groupID: JSON.stringify(parsed.result.data) };
    }
    throwDataShape(operationName, parsed.result, '班级 ID 字符串或对象');
}

export function parseAccountMutation(operationName, value) {
    if (operationName !== 'AddStudent' && operationName !== 'AddTeacher') {
        throw new TypeError(`不支持的账号操作 ${operationName}`);
    }
    const parsed = parseResult(operationName, value);
    if (parsed.status === 'failure') return parsed;
    if (parsed.result.data === null) throwDataShape(operationName, parsed.result, '字符串数组或其 JSON 字符串');
    return { ...parsed, accounts: validateStringArray(operationName, parsed.result) };
}
