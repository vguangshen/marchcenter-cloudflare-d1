import {
    OfficialSoapResponseError,
    OfficialSoapTransportError
} from '../errors.js';
import {
    buildSoapActionHeader,
    buildSoapEnvelope,
    SOAP11_CONTENT_TYPE
} from './envelope.js';
import { buildConfirmedAxisEndpoint, getSoapOperation } from './schemaRegistry.js';
import { parseSoapResponse } from './responseParser.js';

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createAxisSoapClient(options = {}) {
    const fetchImplementation = options.fetchImplementation || globalThis.fetch;
    if (typeof fetchImplementation !== 'function') throw new TypeError('fetchImplementation 必须是函数');
    const credentials = options.credentials;
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

    return Object.freeze({
        async call({ profileName, operationName, baseUrl, parameters = {} }) {
            const operation = getSoapOperation(profileName, operationName);
            const endpoint = buildConfirmedAxisEndpoint(baseUrl);
            const body = buildSoapEnvelope({ profileName, operationName, parameters, credentials });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            let response;
            try {
                response = await fetchImplementation(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': SOAP11_CONTENT_TYPE,
                        SOAPAction: buildSoapActionHeader(operation)
                    },
                    body,
                    signal: controller.signal
                });
            } catch (cause) {
                throw new OfficialSoapTransportError(
                    controller.signal.aborted ? 'SOAP 请求超时' : 'SOAP 传输失败',
                    { cause, details: { endpoint, operationName } }
                );
            } finally {
                clearTimeout(timeout);
            }

            const declaredLength = Number(response.headers?.get?.('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
                throw new OfficialSoapResponseError('SOAP 响应超过大小限制', {
                    code: 'OFFICIAL_SOAP_RESPONSE_TOO_LARGE',
                    details: { declaredLength, maxResponseBytes }
                });
            }
            const responseText = await response.text();
            const actualLength = new TextEncoder().encode(responseText).byteLength;
            if (actualLength > maxResponseBytes) {
                throw new OfficialSoapResponseError('SOAP 响应超过大小限制', {
                    code: 'OFFICIAL_SOAP_RESPONSE_TOO_LARGE',
                    details: { actualLength, maxResponseBytes }
                });
            }
            return parseSoapResponse({
                status: response.status,
                ok: response.ok,
                body: responseText,
                operation
            });
        }
    });
}

