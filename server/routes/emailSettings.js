import express from '../compat/express.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import {
    emailSendErrorMessage, emailServiceState, isValidEmail, mergeEmailSettings, publicEmailSettings,
    readEmailSettings, sendTestEmail, writeEmailSettings
} from '../services/emailService.js';

const router = express.Router();

function publicPayload(settings) {
    return {
        settings: publicEmailSettings(settings),
        status: emailServiceState(settings)
    };
}

function validateSettings(settings) {
    if (settings.fromEmail && !isValidEmail(settings.fromEmail)) {
        throw Object.assign(new Error('发件邮箱必须是完整邮箱地址，例如 noreply@mail.marchcenter.top，不能只填写域名'), { status: 400 });
    }
    if (settings.enabled && !settings.fromEmail) {
        throw Object.assign(new Error('启用邮件服务前，请填写发件邮箱'), { status: 400 });
    }
    if (settings.replyTo && !isValidEmail(settings.replyTo)) {
        throw Object.assign(new Error('回复邮箱格式不正确'), { status: 400 });
    }
    if (settings.enabled && !settings.resendApiKey) {
        throw Object.assign(new Error('启用 Resend 前，请填写 API Key'), { status: 400 });
    }
}

router.get('/', authMiddleware, adminOnly, async (_req, res) => {
    try {
        res.json(publicPayload(await readEmailSettings()));
    } catch (error) {
        res.status(500).json({ error: error.message || '邮件服务配置读取失败' });
    }
});

// 与 SSO 配置的 reveal-secrets 一致：列表接口绝不返回密钥原文，
// 管理员点击“显示”时才按需解密一次，且响应禁止缓存。
router.get('/reveal', authMiddleware, adminOnly, async (_req, res) => {
    try {
        const settings = await readEmailSettings();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.json({ resendApiKey: settings.resendApiKey || '' });
    } catch (error) {
        res.status(500).json({ error: '密钥读取失败: ' + error.message });
    }
});

router.put('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const settings = mergeEmailSettings(req.body, await readEmailSettings());
        validateSettings(settings);
        res.json({ success: true, ...publicPayload(await writeEmailSettings(settings)) });
    } catch (error) {
        res.status(Number(error.status) || 500).json({ error: error.message || '邮件服务配置保存失败' });
    }
});

router.post('/test', authMiddleware, adminOnly, async (req, res) => {
    try {
        const settings = mergeEmailSettings(req.body?.settings, await readEmailSettings());
        const recipient = String(req.body?.recipient || '').trim();
        validateSettings({ ...settings, enabled: true });
        if (!isValidEmail(recipient)) return res.status(400).json({ error: '请填写有效的测试收件邮箱' });
        await sendTestEmail({ settings, to: recipient });
        res.json({ success: true, message: '测试邮件已提交发送，请检查收件箱' });
    } catch (error) {
        console.error('Email service test failed:', error);
        const code = String(error?.code || '');
        const status = Number(error?.status) >= 400 && Number(error?.status) < 500 && !code.startsWith('RESEND_')
            ? Number(error.status)
            : 503;
        res.status(status).json({
            error: emailSendErrorMessage(error),
            code: code || 'EMAIL_TEST_FAILED'
        });
    }
});

export default router;
