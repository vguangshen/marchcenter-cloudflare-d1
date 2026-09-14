import crypto from 'crypto';
import { validateConfirmedOfficialBaseUrl } from '../officialJumpConfig.js';

// This is the protocol identifier used by the recovered Java competition
// platform for the evaluator payload. It is part of the vendor wire format,
// not an application credential; the application never exposes it to clients.
const EXPERT_PAYLOAD_KEY = 'itmc_token_users';
const EXPERT_NAME_PATTERN = /^[^\u0000-\u001f\u007f=]{2,64}$/u;

function requireTokenPart(value, label) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.length > 128 || normalized.includes('=')
        || /[\u0000-\u001f\u007f]/u.test(normalized)) {
        throw new Error(`${label}不符合原版评委入口格式`);
    }
    return normalized;
}

/**
 * The original Java platform encrypts "studentLoginName=expertName" with
 * AES/ECB/PKCS5Padding and then URL-encodes the Base64 output.  Keep this
 * protocol detail isolated from the route so the normal SSO code does not
 * acquire evaluator-specific crypto branches.
 */
export function buildExpertPayloadPlaintext(studentLoginName, expertName) {
    const student = requireTokenPart(studentLoginName, '学生账号');
    const expert = requireTokenPart(expertName, '评委账号');
    if (!EXPERT_NAME_PATTERN.test(expert)) throw new Error('评委账号不符合原版评委入口格式');
    return `${student}=${expert}`;
}

export function normalizeExpertName(value, fallback) {
    const expertName = String(value ?? fallback ?? '').trim();
    if (!EXPERT_NAME_PATTERN.test(expertName)) {
        throw new Error('评委账号长度需为 2–64 位，且不能包含等号或控制字符');
    }
    return expertName;
}

export function encryptExpertPayload(plaintext) {
    const source = String(plaintext ?? '');
    if (!source) throw new Error('评委入口参数不能为空');
    const cipher = crypto.createCipheriv(
        'aes-128-ecb',
        Buffer.from(EXPERT_PAYLOAD_KEY, 'utf8'),
        // The Node-compatible Worker runtime rejects a literal null here even
        // though Node's native implementation accepts it for ECB. An empty IV
        // expresses the same no-IV ECB mode and works in both runtimes.
        Buffer.alloc(0)
    );
    cipher.setAutoPadding(true);
    return Buffer.concat([
        cipher.update(Buffer.from(source, 'utf8')),
        cipher.final()
    ]).toString('base64');
}

export function buildJavaExpertJumpUrl(baseUrl, studentLoginName, expertName) {
    const base = validateConfirmedOfficialBaseUrl(baseUrl);
    const plaintext = buildExpertPayloadPlaintext(studentLoginName, expertName);
    const payload = encryptExpertPayload(plaintext);
    return `${base}/open/toExpertPage?expertuserdata=${encodeURIComponent(payload)}`;
}
