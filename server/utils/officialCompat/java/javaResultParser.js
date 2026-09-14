import {
    OfficialJavaResponseError,
    OfficialResultParseError,
    OfficialResultShapeError
} from '../errors.js';
import { decodeOfficialResult, hasOfficialResultData } from '../resultCodec.js';

export function parseJavaResult(raw, operationName) {
    if (raw === '') {
        throw new OfficialJavaResponseError(`${operationName} 返回空字符串`, {
            operationName,
            raw,
            code: 'OFFICIAL_JAVA_EMPTY_RESPONSE'
        });
    }
    try {
        return decodeOfficialResult(raw);
    } catch (cause) {
        if (cause instanceof OfficialResultParseError || cause instanceof OfficialResultShapeError) {
            throw new OfficialJavaResponseError(`${operationName} 返回无效 Result`, {
                operationName,
                raw,
                cause,
                code: 'OFFICIAL_JAVA_RESULT_INVALID'
            });
        }
        throw cause;
    }
}

export function requireJavaResultData(result, operationName, options = {}) {
    if (!hasOfficialResultData(result)) {
        throw new OfficialJavaResponseError(`${operationName} 缺少 data`, {
            operationName,
            raw: result.raw,
            code: 'OFFICIAL_JAVA_DATA_MISSING'
        });
    }
    if (result.data === null && !options.allowNull) {
        throw new OfficialJavaResponseError(`${operationName} 的 data 为 null`, {
            operationName,
            raw: result.raw,
            code: 'OFFICIAL_JAVA_DATA_NULL'
        });
    }
    return result.data;
}
