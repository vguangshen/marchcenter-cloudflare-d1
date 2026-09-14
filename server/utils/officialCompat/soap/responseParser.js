import {
    OfficialSoapFaultError,
    OfficialSoapHttpError,
    OfficialSoapResponseError
} from '../errors.js';
import { normalizeOfficialResult } from '../resultCodec.js';

function regexName(name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXmlText(value) {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function nodeContent(xml, localName) {
    const name = regexName(localName);
    const paired = new RegExp(`<(?:(?:[\\w.-]+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, 'i').exec(xml);
    if (paired) return { found: true, content: paired[1] };
    const selfClosing = new RegExp(`<(?:(?:[\\w.-]+):)?${name}(?:\\s[^>]*)?\\s*/>`, 'i').test(xml);
    return selfClosing ? { found: true, content: '' } : { found: false, content: '' };
}

function textContent(xml, localName) {
    const node = nodeContent(xml, localName);
    if (!node.found) return '';
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(node.content);
    const text = cdata ? cdata[1] : node.content.replace(/<[^>]+>/g, '');
    return decodeXmlText(text);
}

export function sanitizeSoapRaw(raw, maxLength = 65536) {
    const value = String(raw ?? '')
        .replace(/(<(?:(?:[\w.-]+):)?Uname(?:\s[^>]*)?>)[\s\S]*?(<\/(?:(?:[\w.-]+):)?Uname\s*>)/gi, '$1[REDACTED]$2')
        .replace(/(<(?:(?:[\w.-]+):)?Password(?:\s[^>]*)?>)[\s\S]*?(<\/(?:(?:[\w.-]+):)?Password\s*>)/gi, '$1[REDACTED]$2')
        .replace(/(Authorization|platformToken)(\s*[:=]\s*)[^\s<]+/gi, '$1$2[REDACTED]');
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[TRUNCATED]`;
}

function throwFault(raw) {
    const fault = nodeContent(raw, 'Fault');
    if (!fault.found) return;
    const faultCode = textContent(fault.content, 'faultcode');
    const faultString = textContent(fault.content, 'faultstring');
    const faultDetail = textContent(fault.content, 'detail');
    throw new OfficialSoapFaultError(faultString || 'SOAP Fault', {
        raw: sanitizeSoapRaw(raw),
        faultCode,
        faultString,
        faultDetail
    });
}

export function parseSoapResponse({ status = 200, ok = true, body, operation }) {
    const raw = String(body ?? '');
    const safeRaw = sanitizeSoapRaw(raw);
    throwFault(raw);

    if (!ok || status < 200 || status >= 300) {
        throw new OfficialSoapHttpError(`SOAP HTTP ${status}`, { status, raw: safeRaw });
    }
    if (!/<(?:(?:[\w.-]+):)?Envelope(?:\s|>)/i.test(raw) || !/<(?:(?:[\w.-]+):)?Body(?:\s|>)/i.test(raw)) {
        throw new OfficialSoapResponseError('响应不是 SOAP 1.1 Envelope', {
            code: 'OFFICIAL_SOAP_UNKNOWN_STRUCTURE',
            raw: safeRaw
        });
    }

    const resultNode = nodeContent(raw, operation.returnNodeName);
    if (!resultNode.found) {
        throw new OfficialSoapResponseError(`缺少 ${operation.returnNodeName} 节点`, {
            code: 'OFFICIAL_SOAP_RESULT_MISSING',
            raw: safeRaw
        });
    }
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(resultNode.content);
    const serialized = decodeXmlText(cdata ? cdata[1] : resultNode.content);
    if (serialized.length === 0) {
        throw new OfficialSoapResponseError(`${operation.returnNodeName} 为空字符串`, {
            code: 'OFFICIAL_SOAP_RESULT_EMPTY',
            raw: safeRaw
        });
    }

    let parsed;
    try {
        parsed = JSON.parse(serialized);
    } catch (cause) {
        throw new OfficialSoapResponseError(`${operation.returnNodeName} 不是有效 JSON`, {
            code: 'OFFICIAL_SOAP_RESULT_INVALID_JSON',
            raw: safeRaw,
            cause,
            details: { serializedResult: serialized }
        });
    }
    return normalizeOfficialResult(parsed, safeRaw);
}

