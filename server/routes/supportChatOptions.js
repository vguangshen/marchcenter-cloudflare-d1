import express from '../compat/express.js';
import pool from '../config/db.js';
import { adminOnly } from '../middleware/auth.js';
import { isSuperAdmin } from '../utils/roleAccess.js';
import { normalizeSupportQuestion, readSupportAi, readSupportOptions } from '../services/supportChatAutomation.js';

const router = express.Router();

function cleanTemplates(input) {
    if (!Array.isArray(input) || input.length > 20) throw new Error('最多可配置 20 条自动回复模板');
    const ids = new Set();
    const questions = new Set();
    return input.map((item, index) => {
        const id = typeof item?.id === 'string' ? item.id : '';
        const question = typeof item?.question === 'string' ? item.question.trim() : '';
        const answer = typeof item?.answer === 'string' ? item.answer.trim() : '';
        const questionKey = normalizeSupportQuestion(question);
        if (!/^[\w-]{1,80}$/.test(id) || ids.has(id)) throw new Error(`第 ${index + 1} 条模板编号无效或重复`);
        if (!questionKey || question.length > 120 || questions.has(questionKey) || !answer || answer.length > 1500 || answer.includes('\0')) {
            throw new Error(`请检查第 ${index + 1} 条模板的问题和回复，问题不能重复`);
        }
        if (!Array.isArray(item.keywords) || item.keywords.length > 8) throw new Error(`第 ${index + 1} 条模板最多设置 8 个关键词`);
        const keywords = item.keywords.map(keyword => typeof keyword === 'string' ? keyword.trim() : '');
        if (keywords.some(keyword => keyword.length > 40 || normalizeSupportQuestion(keyword).length < 2)) {
            throw new Error(`第 ${index + 1} 条模板的每个关键词需包含 2–40 个有效字符`);
        }
        ids.add(id);
        questions.add(questionKey);
        return { id, question, answer, keywords };
    });
}

router.get('/', async (req, res) => {
    const admin = isSuperAdmin(req.user);
    const { templates, aiEnabled } = await readSupportOptions();
    const aiConfigured = (admin || aiEnabled) && Boolean(await readSupportAi());
    res.json({
        templates: admin ? templates : templates.map(({ id, question }) => ({ id, question })),
        aiEnabled,
        aiConfigured
    });
});

router.put('/', adminOnly, async (req, res) => {
    const { templates: input, aiEnabled } = req.body || {};
    if (typeof aiEnabled !== 'boolean') return res.status(400).json({ error: 'AI 开关设置无效' });
    let templates;
    try { templates = cleanTemplates(input); } catch (error) { return res.status(400).json({ error: error.message }); }
    const aiConfigured = Boolean(await readSupportAi());
    if (aiEnabled && !aiConfigured) return res.status(409).json({ error: '请先在 AI API 配置中保存可用的接口、模型和 API Key' });
    await pool.query(
        `INSERT INTO support_chat_options (id, templates_json, ai_enabled) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET templates_json = excluded.templates_json, ai_enabled = excluded.ai_enabled`,
        [JSON.stringify(templates), aiEnabled ? 1 : 0]
    );
    res.json({ templates, aiEnabled, aiConfigured });
});

export default router;
