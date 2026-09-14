import {
    OfficialJavaHttpError,
    OfficialJavaResponseError,
    OfficialJavaTimeoutError,
    OfficialJavaTransportError
} from '../errors.js';
import { encodeJavaForm } from './formCodec.js';
import { getJavaOperation, orderJavaOperationParameters } from './operationRegistry.js';

export const JAVA_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=UTF-8';
export const DEFAULT_JAVA_TIMEOUT_MS = 15_000;
export const DEFAULT_JAVA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createJavaHttpTransport(options = {}) {
    const fetchImplementation = options.fetchImplementation || globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? DEFAULT_JAVA_TIMEOUT_MS;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_JAVA_MAX_RESPONSE_BYTES;
    if (typeof fetchImplementation !== 'function') throw new TypeError('fetchImplementation 必须是函数');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs 必须是正数');
    if (!Number.isFinite(maxResponseBytes) || maxResponseBytes <= 0) {
        throw new TypeError('maxResponseBytes 必须是正数');
    }

    return Object.freeze({
        async post({ openBaseUrl, operationName, platformToken, values = {} }) {
            const schema = getJavaOperation(operationName);
            const body = encodeJavaForm(orderJavaOperationParameters(operationName, values));
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            let response;
            try {
                response = await fetchImplementation(`${openBaseUrl}${schema.path}`, {
                    method: schema.method,
                    headers: {
                        'Content-Type': JAVA_FORM_CONTENT_TYPE,
                        platformToken: platformToken == null ? '' : String(platformToken)
                    },
                    body,
                    signal: controller.signal
                });
            } catch (cause) {
                if (controller.signal.aborted || cause?.name === 'AbortError') {
                    throw new OfficialJavaTimeoutError(`${operationName} 请求超时`, { cause });
                }
                throw new OfficialJavaTransportError(`${operationName} 网络请求失败`, { cause });
            } finally {
                clearTimeout(timer);
            }
            const declaredLength = Number(response.headers?.get?.('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
                throw new OfficialJavaResponseError(`${operationName} 响应超过大小限制`, {
                    operationName,
                    code: 'OFFICIAL_JAVA_RESPONSE_TOO_LARGE',
                    details: { declaredLength, maxResponseBytes }
                });
            }
            const raw = await response.text();
            const actualLength = new TextEncoder().encode(raw).byteLength;
            if (actualLength > maxResponseBytes) {
                throw new OfficialJavaResponseError(`${operationName} 响应超过大小限制`, {
                    operationName,
                    code: 'OFFICIAL_JAVA_RESPONSE_TOO_LARGE',
                    details: { actualLength, maxResponseBytes }
                });
            }
            if (!response.ok) {
                throw new OfficialJavaHttpError(`${operationName} HTTP 状态 ${response.status}`, {
                    status: response.status,
                    raw
                });
            }
            return raw;
        }
    });
}
