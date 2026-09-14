import '../config/env.js';
import crypto from 'crypto';
import { getEnv } from '../config/runtime.js';

const SECRET_FIELDS = new Set([
    'tokenNumber', 'tokenPassword', 'soapUsername', 'soapPassword',
    'studentInitialPassword', 'secretKey', 'password',
    'signingSecret',
    'resendApiKey',
    // Per-executor database credentials are encrypted as one server-side value.
    // They are only returned by the administrator-only account-management API.
    'databaseConnections'
]);

function encryptionKey() {
    const source = getEnv('SSO_CONFIG_ENCRYPTION_KEY');
    if (!source && getEnv('NODE_ENV') === 'production') {
        throw new Error('SSO_CONFIG_ENCRYPTION_KEY 未配置，无法安全保存 SSO 凭据');
    }
    return crypto.createHash('sha256').update(source || 'marchcenter-local-sso-config-key').digest();
}

function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decrypt(value) {
    const [version, ivText, tagText, encryptedText] = String(value || '').split('.');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('SSO 凭据密文格式无效');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final()
    ]).toString('utf8');
}

// Generic helpers for server-only secrets which need to be recoverable later.
// The encryption key remains a Worker secret and encrypted values alone are not usable.
export function encryptSecretValue(value) {
    if (value === undefined || value === null || value === '') return '';
    return encrypt(String(value));
}

export function decryptSecretValue(value) {
    if (!value) return '';
    return decrypt(String(value));
}

export function decodeStoredConfig(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : { ...(raw || {}) };
    if (!parsed.__encryptedSecrets) return parsed;
    const secrets = JSON.parse(decrypt(parsed.__encryptedSecrets));
    delete parsed.__encryptedSecrets;
    return { ...parsed, ...secrets };
}

export function encodeStoredConfig(config, previous = {}) {
    const merged = { ...previous };
    for (const [key, value] of Object.entries(config || {})) {
        // Secret inputs are intentionally blank when an existing configuration is
        // edited. A blank value means "keep the stored secret", not "erase it".
        if (SECRET_FIELDS.has(key) && (value === undefined || value === null || value === '')) continue;
        merged[key] = value;
    }
    const publicValues = {};
    const secrets = {};
    for (const [key, value] of Object.entries(merged)) {
        if (key === '__encryptedSecrets') continue;
        if (SECRET_FIELDS.has(key)) {
            if (value !== undefined && value !== null && value !== '') secrets[key] = value;
        } else {
            publicValues[key] = value;
        }
    }
    if (Object.keys(secrets).length) publicValues.__encryptedSecrets = encrypt(JSON.stringify(secrets));
    return publicValues;
}

export function publicConfig(config) {
    const result = {};
    let hasSecrets = false;
    const configuredSecrets = {};
    for (const [key, value] of Object.entries(config || {})) {
        if (SECRET_FIELDS.has(key) || key === '__encryptedSecrets') {
            hasSecrets = hasSecrets || Boolean(value);
            if (SECRET_FIELDS.has(key)) configuredSecrets[key] = Boolean(value);
            // Identifiers are encrypted at rest but may be shown to an authenticated
            // administrator. Passwords and keys are never returned to the browser.
            if ((key === 'soapUsername' || key === 'tokenNumber') && value) result[key] = value;
            continue;
        }
        result[key] = value;
    }
    return { ...result, hasSecrets, configuredSecrets };
}
