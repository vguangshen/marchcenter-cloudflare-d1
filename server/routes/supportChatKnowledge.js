import express from '../compat/express.js';
import { knowledgeQuestionKey, readSupportKnowledge, recognizeKnowledge, writeSupportKnowledge } from '../services/supportChatKnowledge.js';
import { ROLES } from '../utils/roleAccess.js';

const router = express.Router();
const PAGE_SIZE = 24;
const STATES = ['all', 'enabled', 'disabled'];
const keyText = (value) => value.normalize('NFKC').toLowerCase();

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function endpoint(fallback, handler) {
    return async (req, res) => {
        try { return await handler(req, res); } catch (error) {
            if ((error.status >= 400 && error.status < 500) || error.status === 503) return res.status(error.status).json({ error: error.message });
            console.error(fallback, error);
            return res.status(500).json({ error: fallback });
        }
    };
}

function cleanText(value, label, length, { optional = false, multiline = false } = {}) {
    const text = typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n') : '';
    if ((!text && !optional) || text.length > length || text.includes('\0') || (!multiline && text.includes('\n'))) {
        throw httpError(400, `请检查${label}，限 ${length} 个字符${optional ? '' : '且不能为空'}`);
    }
    return text;
}

function cleanPhrases(values, label, count, length) {
    if (!Array.isArray(values) || values.length > count) throw httpError(400, `${label}最多填写 ${count} 条`);
    const phrases = new Map();
    for (const value of values) {
        const text = cleanText(value, label, length);
        const key = knowledgeQuestionKey(text);
        if (key.length < 2) throw httpError(400, `${label}每条应包含至少两个文字或数字`);
        if (!phrases.has(key)) phrases.set(key, text);
    }
    return [...phrases.values()];
}

function cleanEntry(input) {
    const question = cleanText(input.question, '标准问题', 120);
    if (knowledgeQuestionKey(question).length < 2) throw httpError(400, '标准问题应包含至少两个文字或数字');
    if (typeof input.enabled !== 'boolean') throw httpError(400, '语料状态无效');
    return {
        category: cleanText(input.category, '分类', 32), question,
        answer: cleanText(input.answer, '回复', 1500, { multiline: true }),
        examples: cleanPhrases(input.examples ?? [], '用户说法', 20, 160),
        keywords: cleanPhrases(input.keywords ?? [], '识别词', 8, 40),
        followUp: cleanText(input.followUp, '追问回复', 1500, { optional: true, multiline: true }),
        enabled: input.enabled
    };
}

function assertUniqueQuestion(snapshot, entry) {
    const key = knowledgeQuestionKey(entry.question);
    if (snapshot.entries.some(item => item.id !== entry.id && knowledgeQuestionKey(item.question) === key)) {
        throw httpError(409, '已有相同的标准问题，请编辑原有语料');
    }
}

async function saveEntry(entry, user, revision) {
    const saved = await writeSupportKnowledge(entry, user.id, revision);
    if (!saved) {
        assertUniqueQuestion(await readSupportKnowledge(), entry);
        throw httpError(409, '语料已由其他管理员更新，请刷新后再试');
    }
    return saved;
}

router.use((req, res, next) => {
    if (req.user?.role !== ROLES.ADMIN && req.user?.role !== ROLES.SUPER_ADMIN) {
        return res.status(403).json({ error: '需要客服管理权限' });
    }
    next();
});

router.get('/', endpoint('读取客服语料失败', async (req, res) => {
    const state = req.query.state || 'all';
    const page = Number(req.query.page ?? 1);
    if (!STATES.includes(state)) throw httpError(400, '语料状态筛选无效');
    if (!Number.isSafeInteger(page) || page < 1) throw httpError(400, '页码无效');
    const category = cleanText(req.query.category, '分类', 32, { optional: true });
    const query = keyText(cleanText(req.query.q, '搜索内容', 120, { optional: true }));
    const snapshot = await readSupportKnowledge();
    const results = snapshot.entries.filter(entry => (
        (!category || entry.category === category)
        && (state === 'all' || entry.enabled === (state === 'enabled'))
        && (!query || [entry.id, entry.question, entry.answer, entry.followUp, entry.category, ...entry.examples, ...entry.keywords].some(text => keyText(text).includes(query)))
    ));
    const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
    const current = Math.min(page, totalPages);
    res.json({
        entries: results.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
        page: current, total: results.length, totalPages, categories: snapshot.categories, summary: snapshot.summary
    });
}));

router.post('/test', endpoint('意图识别测试失败', async (req, res) => {
    const { text, contextIntentId } = req.body || {};
    const input = cleanText(text, '测试消息', 2000, { multiline: true });
    const snapshot = await readSupportKnowledge();
    res.json(recognizeKnowledge(input, snapshot, typeof contextIntentId === 'string' ? contextIntentId : undefined));
}));

router.post('/', endpoint('新增客服语料失败', async (req, res) => {
    const entry = { id: `custom-${crypto.randomUUID()}`, ...cleanEntry(req.body || {}), builtin: false };
    assertUniqueQuestion(await readSupportKnowledge(), entry);
    res.status(201).json({ entry: await saveEntry(entry, req.user) });
}));

function changeEntry(fallback, update) {
    return endpoint(fallback, async (req, res) => {
        const snapshot = await readSupportKnowledge();
        const current = snapshot.byId.get(req.params.id);
        if (!current) throw httpError(404, '客服语料不存在');
        if (req.body?.revision !== current.revision) throw httpError(409, '语料已由其他管理员更新，请刷新后再试');
        const entry = { ...current, ...update(req.body) };
        if (entry.question !== current.question) assertUniqueQuestion(snapshot, entry);
        res.json({ entry: await saveEntry(entry, req.user, current.revision) });
    });
}

router.put('/:id', changeEntry('保存客服语料失败', cleanEntry));
router.patch('/:id', changeEntry('更新客服语料状态失败', input => {
    if (typeof input.enabled !== 'boolean') throw httpError(400, '语料状态无效');
    return { enabled: input.enabled };
}));

export default router;
