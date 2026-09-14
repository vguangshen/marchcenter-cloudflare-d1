import { OfficialAdapterParameterError } from '../errors.js';

const JAVA_FORM_SAFE = /^[A-Za-z0-9.*_-]$/;

/** Java URLEncoder.encode(value, "UTF-8") compatible encoding. */
export function javaUrlEncode(value) {
    if (value === null || value === undefined) {
        throw new OfficialAdapterParameterError('Java URLEncoder 不接受 null');
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new OfficialAdapterParameterError('不安全数字不能作为 Java long/form 参数', {
            details: { value: String(value) }
        });
    }
    const text = String(value);
    let result = '';
    let pending = '';
    const flush = () => {
        if (!pending) return;
        for (const byte of new TextEncoder().encode(pending)) {
            result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
        }
        pending = '';
    };
    for (const character of text) {
        if (JAVA_FORM_SAFE.test(character)) {
            flush();
            result += character;
        } else if (character === ' ') {
            flush();
            result += '+';
        } else {
            pending += character;
        }
    }
    flush();
    return result;
}

/** Encode ordered [name, value] tuples like Apache UrlEncodedFormEntity. */
export function encodeJavaForm(entries) {
    if (!Array.isArray(entries)) throw new TypeError('form entries 必须是数组');
    return entries.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError('form entry 必须为 [name, value]');
        const [name, value] = entry;
        const encodedName = javaUrlEncode(name);
        return value === null || value === undefined
            ? encodedName
            : `${encodedName}=${javaUrlEncode(value)}`;
    }).join('&');
}

export function javaUrlDecode(value) {
    if (value === null || value === undefined) return '';
    try {
        return decodeURIComponent(String(value).replace(/\+/g, ' '));
    } catch (cause) {
        throw new OfficialAdapterParameterError('Java URLDecoder 输入无效', { cause, raw: String(value) });
    }
}
