import {
    validateConfirmedOfficialBaseUrl,
    validateOfficialPaasV2Address,
    validateOfficialDirectUrl
} from './officialJumpConfig.js';
import { OfficialJumpConfigError } from './errors.js';

export function validateOfficialCardAddress(method, value) {
    if (method === 'direct') return validateOfficialDirectUrl(value);
    if (method === 'paasV2') return validateOfficialPaasV2Address(value);
    return validateConfirmedOfficialBaseUrl(value);
}

/**
 * A card's jump URL is the sole visible address for the official adapter. The
 * returned object is request-scoped and leaves the stored configuration intact.
 */
export function mapCardAddressToOfficialConfig(config = {}, cardUrl) {
    const officialBaseUrl = validateOfficialCardAddress(config.method, cardUrl);
    return {
        ...config,
        officialBaseUrl,
        officialBaseUrlConfirmed: true
    };
}

/** Network-free URL/risk gate used before credentials or adapter execution. */
export function validateOfficialTransportAddress(config = {}, context = {}) {
    const value = Object.prototype.hasOwnProperty.call(context, 'cardUrl')
        ? context.cardUrl
        : config.officialBaseUrl;
    const officialBaseUrl = validateOfficialCardAddress(config.method, value);
    const parsed = new URL(officialBaseUrl);
    if (parsed.protocol === 'http:' && config.allowHttp !== true) {
        throw new OfficialJumpConfigError('HTTP 平台必须显式启用明文传输风险配置', {
            code: 'OFFICIAL_HTTP_NOT_ALLOWED'
        });
    }
    return true;
}

