import pool from '../config/db.js';
import { decodeStoredConfig, encodeStoredConfig } from '../utils/configSecrets.js';

export const EMAIL_CONFIG_KEY = 'email_service';
export const DEFAULT_EMAIL_SETTINGS = Object.freeze({
    provider: 'resend',
    enabled: false,
    fromEmail: '',
    fromName: 'MarchCenter',
    replyTo: '',
    resendApiKey: '',
    hasResendApiKey: false,
    verificationSubject: 'MarchCenter 登录验证码',
    verificationHeading: 'MarchCenter 登录验证码',
    verificationIntro: '您正在登录 MarchCenter，请使用下方验证码完成身份校验。',
    verificationFooter: '如非本人操作，请忽略本邮件。请勿将验证码告知他人。',
    codeTtlMinutes: 10,
    resendSeconds: 60
});

const clampInteger = (value, fallback, min, max) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeEmailSettings(value = {}) {
    const settings = value && typeof value === 'object' ? value : {};
    const resendApiKey = String(settings.resendApiKey || '').trim().slice(0, 512);
    return {
        provider: 'resend',
        enabled: Boolean(settings.enabled),
        fromEmail: String(settings.fromEmail || '').trim().slice(0, 254),
        fromName: String(settings.fromName || DEFAULT_EMAIL_SETTINGS.fromName).trim().slice(0, 80) || DEFAULT_EMAIL_SETTINGS.fromName,
        replyTo: String(settings.replyTo || '').trim().slice(0, 254),
        resendApiKey,
        hasResendApiKey: Boolean(resendApiKey || settings.hasResendApiKey),
        verificationSubject: String(settings.verificationSubject || DEFAULT_EMAIL_SETTINGS.verificationSubject).trim().slice(0, 160) || DEFAULT_EMAIL_SETTINGS.verificationSubject,
        verificationHeading: String(settings.verificationHeading || DEFAULT_EMAIL_SETTINGS.verificationHeading).trim().slice(0, 120) || DEFAULT_EMAIL_SETTINGS.verificationHeading,
        verificationIntro: String(settings.verificationIntro || DEFAULT_EMAIL_SETTINGS.verificationIntro).trim().slice(0, 500) || DEFAULT_EMAIL_SETTINGS.verificationIntro,
        verificationFooter: String(settings.verificationFooter || DEFAULT_EMAIL_SETTINGS.verificationFooter).trim().slice(0, 500) || DEFAULT_EMAIL_SETTINGS.verificationFooter,
        codeTtlMinutes: clampInteger(settings.codeTtlMinutes, DEFAULT_EMAIL_SETTINGS.codeTtlMinutes, 5, 30),
        resendSeconds: clampInteger(settings.resendSeconds, DEFAULT_EMAIL_SETTINGS.resendSeconds, 30, 300)
    };
}

export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function emailSendErrorMessage(error) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').trim().slice(0, 240);
    if (Number(error?.status) >= 400 && Number(error?.status) < 500 && !code.startsWith('RESEND_')) {
        return message || '邮件配置内容不正确';
    }
    if (code === 'RESEND_KEY_MISSING' || code === 'RESEND_401') return 'Resend API Key 无效或尚未配置';
    if (code === 'RESEND_TIMEOUT') return 'Resend 请求超时，请稍后再试';
    if (code === 'RESEND_403') return 'Resend 拒绝发送，请检查 API Key 权限与发件域名';
    if (code === 'RESEND_422') return `Resend 发件参数无效${message ? `：${message}` : ''}`;
    if (code === 'RESEND_429') return 'Resend 免费额度或发送频率已达到上限，请稍后再试';
    return message ? `Resend 发送失败：${message}` : 'Resend 发送失败，请检查密钥、域名和发件地址';
}

export function emailServiceState(settings) {
    const normalized = normalizeEmailSettings(settings);
    const senderConfigured = isValidEmail(normalized.fromEmail);
    const providerAvailable = Boolean(normalized.resendApiKey || normalized.hasResendApiKey);
    return {
        provider: normalized.provider,
        providerAvailable,
        hasResendApiKey: Boolean(normalized.resendApiKey || normalized.hasResendApiKey),
        senderConfigured,
        enabled: normalized.enabled,
        ready: Boolean(normalized.enabled && providerAvailable && senderConfigured)
    };
}

function parseStoredConfig(raw) {
    if (!raw) return {};
    return decodeStoredConfig(typeof raw === 'string' ? raw : JSON.stringify(raw));
}

async function readStoredEmailConfig() {
    const [rows] = await pool.query(
        'SELECT config_value FROM system_configs WHERE config_key = ?',
        [EMAIL_CONFIG_KEY]
    );
    if (!rows.length) return {};
    try {
        return parseStoredConfig(rows[0].config_value);
    } catch {
        return {};
    }
}

export function mergeEmailSettings(value = {}, previous = {}) {
    const submitted = value && typeof value === 'object' ? value : {};
    const merged = { ...previous, ...submitted };
    if (!String(submitted.resendApiKey || '').trim()) {
        merged.resendApiKey = previous.resendApiKey || '';
    }
    return normalizeEmailSettings(merged);
}

export function publicEmailSettings(value = {}) {
    const settings = normalizeEmailSettings(value);
    return {
        ...settings,
        resendApiKey: '',
        hasResendApiKey: Boolean(settings.resendApiKey || settings.hasResendApiKey)
    };
}

export async function readEmailSettings() {
    return normalizeEmailSettings(await readStoredEmailConfig());
}

export async function writeEmailSettings(value) {
    const previous = await readStoredEmailConfig();
    const settings = mergeEmailSettings(value, previous);
    const stored = encodeStoredConfig(settings, previous);
    await pool.query(
        `INSERT INTO system_configs (config_key, config_value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(config_key) DO UPDATE SET
            config_value = excluded.config_value,
            updated_at = CURRENT_TIMESTAMP`,
        [EMAIL_CONFIG_KEY, JSON.stringify(stored)]
    );
    return settings;
}

function safeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function replaceVariables(value, variables) {
    return Object.entries(variables).reduce(
        (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, String(replacement)),
        String(value || '')
    );
}

function emailPayload(settings, { to, subject, heading, intro, footer, code = '', username = '' }) {
    const minutes = settings.codeTtlMinutes;
    const variables = { code, username, minutes };
    const resolvedSubject = replaceVariables(subject, variables);
    const resolvedHeading = replaceVariables(heading, variables);
    const resolvedIntro = replaceVariables(intro, variables);
    const resolvedFooter = replaceVariables(footer, variables);
    const codeBlock = code
        ? `<div style="margin:24px 0;padding:18px;border-radius:14px;background:#eef2ff;text-align:center;font-size:32px;font-weight:800;letter-spacing:8px;color:#4f46e5">${safeHtml(code)}</div>`
        : '';
    const textCode = code ? `\n\n验证码：${code}\n` : '';
    return {
        to,
        from: { email: settings.fromEmail, name: settings.fromName },
        ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
        subject: resolvedSubject,
        text: `${resolvedHeading}\n\n${resolvedIntro}${textCode}\n${resolvedFooter}`,
        html: `
            <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:auto;padding:28px;color:#0f172a">
                ${username ? `<p style="font-size:14px;color:#64748b">您好，${safeHtml(username)}</p>` : ''}
                <h1 style="font-size:22px;margin:10px 0">${safeHtml(resolvedHeading)}</h1>
                <p style="font-size:13px;line-height:1.8;color:#64748b">${safeHtml(resolvedIntro)}</p>
                ${codeBlock}
                <p style="font-size:13px;line-height:1.8;color:#64748b">${safeHtml(resolvedFooter)}</p>
            </div>`
    };
}

function resendFromAddress(settings) {
    const safeName = String(settings.fromName || '').replace(/[\r\n<>]/g, '').trim();
    return safeName ? `${safeName} <${settings.fromEmail}>` : settings.fromEmail;
}

async function sendWithResend(settings, payload) {
    if (!settings.resendApiKey) {
        throw Object.assign(new Error('Resend API Key 尚未配置'), { code: 'RESEND_KEY_MISSING' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Resend 请求超时')), 30_000);
    let response;
    try {
        response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${settings.resendApiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `marchcenter-${crypto.randomUUID()}`
            },
            body: JSON.stringify({
                from: resendFromAddress(settings),
                to: Array.isArray(payload.to) ? payload.to : [payload.to],
                subject: payload.subject,
                html: payload.html,
                text: payload.text,
                ...(payload.replyTo ? { reply_to: payload.replyTo } : {})
            }),
            signal: controller.signal
        });
    } catch (error) {
        if (controller.signal.aborted) {
            throw Object.assign(new Error('Resend 请求超时，请稍后再试'), {
                code: 'RESEND_TIMEOUT', provider: 'resend', status: 504
            });
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = String(data?.message || `Resend 请求失败（HTTP ${response.status}）`);
        throw Object.assign(new Error(message), {
            code: `RESEND_${response.status}`,
            provider: 'resend',
            status: response.status
        });
    }
    return data;
}

export async function sendVerificationCodeEmail({ settings, to, username, code }) {
    const normalized = normalizeEmailSettings(settings);
    return sendWithResend(normalized, emailPayload(normalized, {
        to,
        username,
        code,
        subject: normalized.verificationSubject,
        heading: normalized.verificationHeading,
        intro: normalized.verificationIntro,
        footer: normalized.verificationFooter
    }));
}

export async function sendRegistrationCodeEmail({ settings, to, username, code }) {
    const normalized = normalizeEmailSettings(settings);
    return sendWithResend(normalized, emailPayload(normalized, {
        to,
        username,
        code,
        subject: 'MarchCenter 注册验证码',
        heading: '验证您的注册邮箱',
        intro: '您正在创建 MarchCenter 教师账号，请使用下方验证码完成邮箱验证。',
        footer: `验证码在 ${normalized.codeTtlMinutes} 分钟内有效。如非本人操作，请忽略本邮件。`
    }));
}

export async function sendPasswordResetCodeEmail({ settings, to, username, code }) {
    const normalized = normalizeEmailSettings(settings);
    return sendWithResend(normalized, emailPayload(normalized, {
        to,
        username,
        code,
        subject: 'MarchCenter 密码重置验证码',
        heading: '重置您的访问密码',
        intro: '您正在通过绑定邮箱重置 MarchCenter 访问密码，请使用下方验证码完成身份校验。',
        footer: `验证码在 ${normalized.codeTtlMinutes} 分钟内有效。如非本人操作，请忽略本邮件并及时检查账号安全。`
    }));
}

export async function sendTestEmail({ settings, to }) {
    const normalized = normalizeEmailSettings(settings);
    return sendWithResend(normalized, emailPayload(normalized, {
        to,
        subject: 'MarchCenter 邮件服务测试',
        heading: '邮件服务连接成功',
        intro: '这是一封由 MarchCenter 系统管理后台发送的测试邮件。',
        footer: '收到此邮件表示邮件服务、发件域名与当前配置均可正常工作。'
    }));
}
