import assert from 'node:assert/strict';
import {
    DEFAULT_EMAIL_SETTINGS,
    emailSendErrorMessage,
    isValidEmail,
    mergeEmailSettings,
    normalizeEmailSettings,
    publicEmailSettings
} from '../server/services/emailService.js';
import { decodeStoredConfig, encodeStoredConfig } from '../server/utils/configSecrets.js';

const defaults = normalizeEmailSettings();
assert.deepEqual(defaults, DEFAULT_EMAIL_SETTINGS);

const normalized = normalizeEmailSettings({
    enabled: true,
    fromEmail: '  noreply@example.com ',
    fromName: '  MarchCenter 通知 ',
    replyTo: ' support@example.com ',
    codeTtlMinutes: 100,
    resendSeconds: 1
});
assert.equal(normalized.enabled, true);
assert.equal(normalized.fromEmail, 'noreply@example.com');
assert.equal(normalized.fromName, 'MarchCenter 通知');
assert.equal(normalized.replyTo, 'support@example.com');
assert.equal(normalized.codeTtlMinutes, 30);
assert.equal(normalized.resendSeconds, 30);
assert.equal(normalizeEmailSettings({ provider: 'cloudflare', resendApiKey: 'k' }).provider, 'resend');

const preserved = mergeEmailSettings(
    { provider: 'resend', resendApiKey: '', fromEmail: 'noreply@mail.marchcenter.top' },
    { provider: 'resend', resendApiKey: 'server-only-key', hasResendApiKey: true }
);
assert.equal(preserved.resendApiKey, 'server-only-key');
assert.equal(preserved.hasResendApiKey, true);

const publicSettings = publicEmailSettings(preserved);
assert.equal(publicSettings.resendApiKey, '');
assert.equal(publicSettings.hasResendApiKey, true);

const stored = encodeStoredConfig(preserved);
assert.equal(JSON.stringify(stored).includes('server-only-key'), false);
assert.equal(decodeStoredConfig(stored).resendApiKey, 'server-only-key');

assert.equal(isValidEmail('user@example.com'), true);
assert.equal(isValidEmail('not-an-email'), false);
assert.equal(
    emailSendErrorMessage(Object.assign(new Error('发件邮箱必须是完整邮箱地址'), { status: 400 })),
    '发件邮箱必须是完整邮箱地址'
);
assert.match(
    emailSendErrorMessage(Object.assign(new Error('validation_error'), { code: 'RESEND_400', status: 400 })),
    /^Resend 发送失败/
);

console.log('Email service tests passed.');
