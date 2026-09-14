import express from '../compat/express.js';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../config/db.js';
import { authMiddleware, adminOnly, getJwtSecret } from '../middleware/auth.js';
import { getEnv } from '../config/runtime.js';
import { isSuperAdmin } from '../utils/roleAccess.js';
import { listAccountColumns, listAccountTables } from '../utils/accountManagementApi.js';
import { readAccountManagementConfig } from '../utils/accountManagementStore.js';
import {
    databaseMappingPrompts, extractAiJson, inferDatabaseMappingFromSchema,
    normalizeCandidateTables, rankDatabaseTables, validateDatabaseMappingSuggestion
} from '../utils/aiDatabaseMapping.js';
import { discoverAiModels } from '../utils/aiModelDiscovery.js';

const router = express.Router();
const MAX_AI_OUTPUT_TOKENS = 131072;

const encryptionKey = () => crypto.createHash('sha256').update(getEnv('SSO_CONFIG_ENCRYPTION_KEY') || getJwtSecret()).digest();

function encryptSecret(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
}

function decryptSecret(value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) return '';
    const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

const parseConfig = value => {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return {}; }
    }
    return value;
};

async function readSettings() {
    const [rows] = await pool.query('SELECT config_json, encrypted_api_key FROM ai_settings WHERE id = 1');
    if (!rows.length) return { config: {}, apiKey: '' };
    return {
        config: parseConfig(rows[0].config_json),
        apiKey: rows[0].encrypted_api_key ? decryptSecret(rows[0].encrypted_api_key) : ''
    };
}

function normalizeAiConfig(value = {}) {
    return {
        ...value,
        apiUrl: String(value.apiUrl || '').trim(),
        modelName: String(value.modelName || '').trim(),
        maxTokens: Math.min(Math.max(Number(value.maxTokens) || 2000, 128), MAX_AI_OUTPUT_TOKENS)
    };
}

function resolveAiEndpoint(config) {
    const apiUrl = String(config.apiUrl || '').trim().replace(/\/+$/, '');
    if (!apiUrl) return '';
    if (/\/(chat\/completions|messages)$/i.test(apiUrl)) return apiUrl;
    if (config.provider === 'anthropic') {
        return /\/v1$/i.test(apiUrl) ? `${apiUrl}/messages` : `${apiUrl}/v1/messages`;
    }
    return `${apiUrl}/chat/completions`;
}

function parseResponseData(value) {
    if (typeof value !== 'string') return value || {};
    try {
        return JSON.parse(value);
    } catch {
        return { text: value };
    }
}

function textFromContent(value) {
    if (typeof value === 'string') return value.trim();
    if (!Array.isArray(value)) return '';
    return value
        .map(item => typeof item === 'string' ? item : (item?.text || item?.content || ''))
        .filter(Boolean)
        .join('\n')
        .trim();
}

function extractAiText(rawData) {
    const data = parseResponseData(rawData);
    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    for (const value of [message.content, message.reasoning_content, choice?.text, data?.output_text, data?.text]) {
        const text = textFromContent(value);
        if (text) return text;
    }
    return (Array.isArray(data?.output) ? data.output : [])
        .flatMap(item => Array.isArray(item?.content) ? item.content : [])
        .map(item => item?.text || item?.content || '')
        .filter(Boolean)
        .join('\n')
        .trim();
}

async function requestAi(config, apiKey, messages, maxTokens, timeoutMs = 60000) {
    const isAnthropic = config.provider === 'anthropic';
    const apiUrl = resolveAiEndpoint(config);
    const requestBody = isAnthropic ? {
        model: config.modelName,
        ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
        messages: messages.filter(message => message.role !== 'system'),
        max_tokens: maxTokens
    } : {
        model: config.modelName,
        messages,
        max_tokens: maxTokens
    };
    const headers = isAnthropic
        ? { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

    return axios.post(apiUrl, requestBody, {
        adapter: 'fetch',
        headers,
        timeout: timeoutMs,
        maxContentLength: 2 * 1024 * 1024
    });
}

router.get('/config', authMiddleware, async (req, res) => {
    try {
        const { config, apiKey } = await readSettings();
        // Only the super administrator may read the decrypted key. Other signed-in
        // users still receive non-secret model information used by the dashboard.
        res.setHeader('Cache-Control', 'no-store');
        res.json({ ...config, apiKey: isSuperAdmin(req.user) ? apiKey : '', hasApiKey: Boolean(apiKey) });
    } catch (err) {
        res.status(500).json({ error: 'AI 配置读取失败: ' + err.message });
    }
});

router.put('/config', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { apiKey, hasApiKey, ...submittedConfig } = req.body || {};
        const config = normalizeAiConfig(submittedConfig);
        const [rows] = !apiKey && hasApiKey
            ? await pool.query('SELECT encrypted_api_key FROM ai_settings WHERE id = 1')
            : [[]];
        const encryptedApiKey = apiKey
            ? encryptSecret(String(apiKey).trim())
            : (hasApiKey ? rows[0]?.encrypted_api_key || null : null);
        await pool.query(
            `INSERT INTO ai_settings (id, config_json, encrypted_api_key, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json,
                 encrypted_api_key = excluded.encrypted_api_key, updated_at = CURRENT_TIMESTAMP`,
            [JSON.stringify(config), encryptedApiKey]
        );
        const savedApiKey = encryptedApiKey ? decryptSecret(encryptedApiKey) : '';
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, config: { ...config, apiKey: savedApiKey, hasApiKey: Boolean(encryptedApiKey) } });
    } catch (err) {
        res.status(500).json({ error: 'AI 配置保存失败: ' + err.message });
    }
});

router.post('/models/discover', authMiddleware, adminOnly, async (req, res) => {
    try {
        const saved = await readSettings();
        const submitted = req.body || {};
        const config = normalizeAiConfig({ ...saved.config, ...submitted });
        const apiKey = String(submitted.apiKey || saved.apiKey || '').trim();
        const discovery = await discoverAiModels(config, apiKey);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, ...discovery });
    } catch (err) {
        const status = Number(err.statusCode || err.status) || 502;
        res.status(status >= 400 && status < 600 ? status : 502).json({
            error: err.message || '上游模型识别失败'
        });
    }
});

router.post('/test', authMiddleware, adminOnly, async (req, res) => {
    const startedAt = Date.now();
    try {
        const saved = await readSettings();
        const submitted = req.body || {};
        const config = normalizeAiConfig({ ...saved.config, ...submitted });
        const apiKey = String(submitted.apiKey || saved.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ error: '请先填写 API Key' });
        if (!/^https:\/\//i.test(config.apiUrl) || !config.modelName) {
            return res.status(400).json({ error: '请填写有效的 HTTPS 接口地址和模型名称' });
        }

        const messages = [
            ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []),
            { role: 'user', content: '这是连接测试，请只回复 OK。' }
        ];
        const response = await requestAi(config, apiKey, messages, 128, 45000);
        const data = parseResponseData(response.data);
        const content = extractAiText(data);
        // A successful 2xx response verifies the URL, credential and model. Some
        // reasoning models consume a small test budget without visible output.
        res.json({
            success: true,
            latencyMs: Date.now() - startedAt,
            modelName: config.modelName,
            responseVerified: Boolean(content || data?.choices || data?.content || data?.output)
        });
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        const status = err.response?.status >= 400 && err.response?.status < 500 ? 400 : 502;
        res.status(status).json({ error: detail || 'AI 连接测试失败' });
    }
});

router.post('/generate', authMiddleware, async (req, res) => {
    try {
        const settings = await readSettings();
        const config = normalizeAiConfig(settings.config);
        const { apiKey } = settings;
        if (!apiKey) return res.status(400).json({ error: '管理员尚未配置 AI API Key' });
        const apiUrl = resolveAiEndpoint(config);
        const modelName = config.modelName;
        if (!/^https:\/\//i.test(apiUrl) || !modelName) return res.status(400).json({ error: 'AI 接口地址或模型配置无效' });
        const title = String(req.body?.title || '').slice(0, 200);
        const category = String(req.body?.category || '综合').slice(0, 100);
        const description = String(req.body?.description || '').slice(0, 1000);
        const prompt = `请你作为我的AI竞赛教练，为我准备参加“${title}”（${category}）生成备赛指南。简介：${description}\n请用Markdown格式，包含：【难度评估】、【核心考点】、【备赛策略】三部分，每部分2-3点，保持精炼，语气鼓励。`;
        const maxTokens = Math.min(
            Math.max(Number(config.maxTokens) || 2000, 128),
            MAX_AI_OUTPUT_TOKENS
        );
        const messages = [
            ...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []),
            { role: 'user', content: prompt }
        ];
        const response = await requestAi(config, apiKey, messages, maxTokens, 90000);
        const content = extractAiText(response.data);
        if (!content) throw new Error('AI 服务未返回有效内容');
        res.json({ content });
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        const status = err.response?.status >= 400 && err.response?.status < 500 ? 400 : 502;
        res.status(status).json({ error: detail || 'AI 服务调用失败' });
    }
});

router.post('/database-mapping', authMiddleware, adminOnly, async (req, res) => {
    try {
        const scope = req.body?.scope === 'classDelete' ? 'classDelete' : req.body?.scope === 'account' ? 'account' : '';
        const apiId = String(req.body?.apiId || '').trim();
        const provider = String(req.body?.provider || '').trim().toLowerCase();
        const databaseName = String(req.body?.databaseName || '').trim();
        const ssoMethod = String(req.body?.ssoMethod || '').trim();
        if (!scope || !apiId || !['mysql', 'sqlserver'].includes(provider) || !databaseName) {
            return res.status(400).json({ error: '请先选择 API 服务器、数据库类型和数据库名称' });
        }
        if (scope === 'classDelete' && provider !== 'mysql') {
            return res.status(400).json({ error: 'Java 班级删除映射仅支持 MySQL' });
        }
        const accountApiConfig = await readAccountManagementConfig(apiId);
        if (!accountApiConfig?.enabled) return res.status(409).json({ error: '所选账号管理 API 不存在或已停用' });
        const settings = await readSettings();
        const config = normalizeAiConfig(settings.config);
        if (!settings.apiKey || !/^https:\/\//i.test(resolveAiEndpoint(config)) || !config.modelName) {
            return res.status(409).json({ error: '请先在系统工具中完成 AI 服务配置' });
        }

        const tables = (await listAccountTables(accountApiConfig, provider, databaseName)).slice(0, 600);
        if (!tables.length) return res.status(409).json({ error: '该数据库没有可供 AI 分析的数据表' });
        const base = {
            scope, provider, databaseName, tables,
            title: req.body?.title, category: req.body?.category, ssoMethod
        };
        const prefilteredTables = rankDatabaseTables(tables, scope, 80);
        const firstPrompt = databaseMappingPrompts({ ...base, tables: prefilteredTables });
        let candidates = [];
        try {
            const firstResponse = await requestAi(config, settings.apiKey, [
                { role: 'system', content: firstPrompt.system },
                { role: 'user', content: firstPrompt.user }
            ], 400, 45000);
            candidates = normalizeCandidateTables(extractAiJson(extractAiText(firstResponse.data))?.candidateTables, tables);
        } catch { /* fall through to deterministic candidates */ }
        if (!candidates.length) candidates = rankDatabaseTables(tables, scope, 12);
        const schemas = await Promise.all(candidates.map(async table => ({
            table,
            columns: await listAccountColumns(accountApiConfig, provider, databaseName, table)
        })));
        const finalPrompt = databaseMappingPrompts({ ...base, schemas });
        let suggestion;
        try {
            const finalResponse = await requestAi(config, settings.apiKey, [
                { role: 'system', content: finalPrompt.system },
                { role: 'user', content: finalPrompt.user }
            ], 600, 60000);
            suggestion = validateDatabaseMappingSuggestion(
                extractAiJson(extractAiText(finalResponse.data)), schemas,
                { scope, provider, ssoMethod }
            );
        } catch (aiError) {
            const fallback = inferDatabaseMappingFromSchema(schemas, { scope, provider, ssoMethod });
            if (!fallback) throw aiError;
            suggestion = validateDatabaseMappingSuggestion(fallback, schemas, { scope, provider, ssoMethod });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, suggestion, analyzedTables: schemas.map(item => item.table) });
    } catch (err) {
        const detail = err.response?.data?.error?.message || err.response?.data?.message || err.message;
        const status = err.response?.status >= 400 && err.response?.status < 500
            ? 400 : Number(err.statusCode || err.status) || 502;
        res.status(status).json({ error: detail || 'AI 数据库映射识别失败' });
    }
});

export default router;
