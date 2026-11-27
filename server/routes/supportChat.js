import express from '../compat/express.js';
import pool from '../config/db.js';
import { waitUntil } from '../config/runtime.js';
import { authMiddleware } from '../middleware/auth.js';
import { maybeReplyToSupportMessage } from '../services/supportChatAutomation.js';
import { isAttachmentForm, readAttachmentForm, readAttachments, saveWithAttachments, streamPrivateAttachment } from '../utils/privateAttachments.js';
import { ROLES } from '../utils/roleAccess.js';
import supportChatOptionsRoutes from './supportChatOptions.js';

const router = express.Router();
const CONVERSATIONS_PER_PAGE = 30;
const MESSAGES_PER_PAGE = 50;
const MAX_MESSAGE_LENGTH = 2000;
const CONVERSATION_SQL = `SELECT c.*, u.username AS owner_username,
    CASE WHEN latest.body = '' THEN '（附件）' ELSE substr(latest.body, 1, 160) END AS last_message,
    latest.author_role AS last_author_role, latest.reply_source AS last_reply_source
    FROM support_chat_conversations c JOIN users u ON u.id = c.user_id
    LEFT JOIN support_chat_messages latest ON latest.id = (
        SELECT id FROM support_chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
    )`;

const isStaff = user => user.role === ROLES.ADMIN || user.role === ROLES.SUPER_ADMIN;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function endpoint(fallback, handle) {
    return async (req, res) => {
        try {
            await handle(req, res);
        } catch (error) {
            if (error.status >= 400 && error.status < 500) {
                return res.status(error.status).json({ error: error.message });
            }
            console.error(fallback, error);
            return res.status(500).json({ error: fallback });
        }
    };
}

function positiveId(input, message) {
    const id = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(id) || id < 1) throw httpError(400, message);
    return id;
}

async function messagePayload(req) {
    const form = isAttachmentForm(req.raw) ? await readAttachmentForm(req.raw, '客服消息') : null;
    const value = form ? form.get('body') : req.body?.body;
    const body = typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n') : '';
    if (body.length > MAX_MESSAGE_LENGTH) throw httpError(400, `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`);
    if (body.includes('\0')) throw httpError(400, '消息包含无效字符');
    const files = form ? await readAttachments(form) : [];
    if (!body && !files.length) throw httpError(400, '请输入消息内容或添加附件');
    const allowAi = form ? form.get('allowAi') === 'true' : req.body?.allowAi === true;
    return { body, files, allowAi };
}

function conversationDto(row) {
    return {
        id: row.id,
        userId: row.user_id,
        ownerUsername: row.owner_username,
        userUnread: row.user_unread,
        staffUnread: row.staff_unread,
        humanRequested: Boolean(row.human_requested),
        lastMessage: row.last_message,
        lastAuthorRole: row.last_author_role,
        lastReplySource: row.last_reply_source || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function messageDto(row, attachments) {
    return {
        id: row.id,
        authorRole: row.author_role,
        authorUsername: row.author_username,
        body: row.body,
        createdAt: row.created_at,
        replySource: row.reply_source || null,
        attachments
    };
}

async function loadViewer(user, id) {
    const [[conversation]] = await pool.query('SELECT user_id FROM support_chat_conversations WHERE id = ?', [id]);
    const owner = conversation?.user_id === user.id;
    const staff = isStaff(user);
    if (!conversation || (!owner && !staff)) throw httpError(404, '客服会话不存在');
    return { owner, staff };
}

function insertAttachments(files) {
    if (!files.length) return [];
    return [[
        `WITH message AS MATERIALIZED (
            SELECT id FROM support_chat_messages WHERE id = last_insert_rowid() AND changes() > 0
         )
         INSERT INTO support_chat_attachments (message_id, object_key, file_name, content_type, size)
         SELECT message.id, json_extract(file.value, '$.key'), json_extract(file.value, '$.fileName'),
                json_extract(file.value, '$.contentType'), json_extract(file.value, '$.size')
         FROM message CROSS JOIN json_each(?) AS file ORDER BY file.key
         RETURNING id, file_name AS fileName, content_type AS contentType, size`,
        [JSON.stringify(files)]
    ]];
}

async function sendMessage(user, { body, files = [], conversationId, role = 'user', humanHandoff = false }) {
    const startConversation = conversationId === undefined;
    const column = startConversation ? 'user_id' : 'id';
    const id = startConversation ? user.id : conversationId;
    const unread = role === 'user' ? 'staff_unread' : 'user_unread';
    const start = startConversation ? [[
        'INSERT INTO support_chat_conversations (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING',
        [user.id]
    ]] : [];
    const handoffGuard = humanHandoff ? 'AND human_requested = 0' : '';
    const handoffUpdate = humanHandoff ? ', human_requested = 1' : '';
    return saveWithAttachments('support-chat', files, async uploaded => {
        const results = await pool.batch([
            ...start,
            [
                `INSERT INTO support_chat_messages (conversation_id, author_id, author_role, body)
                 SELECT id, ?, ?, ? FROM support_chat_conversations WHERE ${column} = ? ${handoffGuard}
                 RETURNING id, author_role, body, created_at, reply_source`,
                [user.id, role, body, id]
            ],
            [
                `UPDATE support_chat_conversations SET ${unread} = ${unread} + 1,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')${handoffUpdate}
                 WHERE ${column} = ? AND changes() > 0`,
                [id]
            ],
            ...insertAttachments(uploaded),
            [`${CONVERSATION_SQL} WHERE c.${column} = ?`, [id]]
        ]);
        const { rows: [message] } = results[start.length];
        const { rows: [conversation] } = results.at(-1);
        if (!conversation || (!message && !humanHandoff)) throw httpError(404, '客服会话不存在');
        const attachments = uploaded.length ? results.at(-2).rows.sort((first, second) => first.id - second.id) : [];
        return {
            conversation: conversationDto(conversation),
            message: message ? messageDto({ ...message, author_username: user.username }, attachments) : null
        };
    });
}

async function postMessage(req, res, conversationId, role = 'user') {
    const { allowAi, ...payload } = await messagePayload(req);
    const result = await sendMessage(req.user, { ...payload, conversationId, role });
    res.status(201).json(result);
    if (role === 'user' && !result.conversation.humanRequested) {
        waitUntil(Promise.resolve().then(() => maybeReplyToSupportMessage(result, { allowAi }))
            .catch(error => console.error('客服自动回复失败', error)));
    }
}

router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
});
router.use(authMiddleware);
router.use('/options', supportChatOptionsRoutes);

router.get('/unread', endpoint('读取客服提醒失败', async (req, res) => {
    const { id } = req.user;
    const [[counts]] = await pool.query(
        `SELECT COALESCE((SELECT user_unread FROM support_chat_conversations WHERE user_id = ?), 0) AS mine,
             CASE WHEN ? THEN COALESCE((SELECT SUM(staff_unread) FROM support_chat_conversations WHERE user_id <> ? AND staff_unread > 0), 0)
                  ELSE 0 END AS staff`,
        [id, isStaff(req.user), id]
    );
    res.json({ ...counts, total: counts.mine + counts.staff });
}));

router.get('/management/overview', endpoint('读取客服概览失败', async (req, res) => {
    if (!isStaff(req.user)) throw httpError(403, '需要客服管理权限');
    const userId = req.user.id;
    const [{ rows: [inbox] }, { rows: [recent] }] = await pool.batch([
        [
            `SELECT COUNT(*) AS totalConversations, COALESCE(SUM(human_requested), 0) AS humanConversations,
                    COALESCE(SUM(staff_unread), 0) AS unreadMessages
             FROM support_chat_conversations WHERE user_id <> ?`,
            [userId]
        ],
        [
            `SELECT COUNT(*) FILTER (WHERE m.author_role = 'user') AS recentUserMessages,
                    COUNT(*) FILTER (WHERE m.reply_source = 'template') AS recentTemplateReplies,
                    COUNT(*) FILTER (WHERE m.reply_source = 'ai') AS recentAiReplies,
                    COUNT(*) FILTER (WHERE m.author_role = 'staff' AND m.reply_source IS NULL AND m.author_id IS NOT NULL) AS recentHumanReplies
             FROM support_chat_messages m JOIN support_chat_conversations c ON c.id = m.conversation_id
             WHERE c.user_id <> ? AND m.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')`,
            [userId]
        ]
    ]);
    res.json({ ...inbox, ...recent });
}));

router.get('/conversations', endpoint('读取客服会话失败', async (req, res) => {
    const staff = isStaff(req.user);
    const scope = req.query.scope || (staff ? 'all' : 'mine');
    if (scope !== 'mine' && scope !== 'all') throw httpError(400, '会话范围无效');
    if (scope === 'all' && !staff) throw httpError(403, '需要客服管理权限');
    const rawPage = req.query.page;
    const page = rawPage === undefined ? 1 : positiveId(rawPage, '页码无效');
    if (page > 10000) throw httpError(400, '页码无效');
    const conditions = [scope === 'mine' ? 'c.user_id = ?' : 'c.user_id <> ?'];
    const params = [req.user.id];
    if (scope === 'all') {
        const queue = req.query.queue || 'all';
        const search = String(req.query.q || '').trim();
        if (!['all', 'human', 'unread'].includes(queue)) throw httpError(400, '会话筛选无效');
        if (search.length > 80) throw httpError(400, '搜索内容不能超过 80 个字符');
        if (queue === 'human') conditions.push('c.human_requested = 1');
        if (queue === 'unread') conditions.push('c.staff_unread > 0');
        if (search) {
            conditions.push('(instr(LOWER(u.username), LOWER(?)) > 0 OR CAST(c.id AS TEXT) = ?)');
            params.push(search, search.replace(/^#/, ''));
        }
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [{ rows: [{ total }] }, { rows: conversations }] = await pool.batch([
        [`SELECT COUNT(*) AS total FROM support_chat_conversations c JOIN users u ON u.id = c.user_id ${where}`, params],
        [
            `${CONVERSATION_SQL} ${where} ORDER BY c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?`,
            [...params, CONVERSATIONS_PER_PAGE, (page - 1) * CONVERSATIONS_PER_PAGE]
        ]
    ]);
    res.json({
        conversations: conversations.map(conversationDto), page, total,
        totalPages: Math.max(1, Math.ceil(total / CONVERSATIONS_PER_PAGE))
    });
}));

router.get('/conversations/:id', endpoint('读取客服消息失败', async (req, res) => {
    const id = positiveId(req.params.id, '会话编号无效');
    const before = req.query.before === undefined ? null : positiveId(req.query.before, '消息编号无效');
    const viewer = await loadViewer(req.user, id);
    const unread = viewer.owner ? 'user_unread' : 'staff_unread';
    const markRead = before === null ? [[
        `UPDATE support_chat_conversations SET ${unread} = 0 WHERE id = ? AND ${unread} > 0`,
        [id]
    ]] : [];
    const history = before === null ? '' : 'AND m.id < ?';
    const params = before === null ? [id] : [id, before];
    const results = await pool.batch([
        [
            `SELECT m.id, m.author_role, m.body, m.created_at, m.reply_source, u.username AS author_username,
                    (SELECT json_group_array(json_object('id', id, 'fileName', file_name, 'contentType', content_type, 'size', size))
                     FROM (SELECT id, file_name, content_type, size FROM support_chat_attachments WHERE message_id = m.id ORDER BY id)) AS attachments
             FROM support_chat_messages m LEFT JOIN users u ON u.id = m.author_id
             WHERE m.conversation_id = ? ${history} ORDER BY m.id DESC LIMIT ?`,
            [...params, MESSAGES_PER_PAGE + 1]
        ],
        ...markRead,
        [`${CONVERSATION_SQL} WHERE c.id = ?`, [id]]
    ]);
    const { rows: messages } = results[0];
    const { rows: [conversation] } = results.at(-1);
    if (!conversation) throw httpError(404, '客服会话不存在');
    res.json({
        conversation: conversationDto(conversation), viewer,
        messages: messages.slice(0, MESSAGES_PER_PAGE).reverse().map(row => messageDto(row, JSON.parse(row.attachments))),
        hasMore: messages.length > MESSAGES_PER_PAGE
    });
}));

router.post('/messages', endpoint('发送客服消息失败', (req, res) => postMessage(req, res)));

router.post('/conversations/:id/messages', endpoint('发送客服消息失败', async (req, res) => {
    const id = positiveId(req.params.id, '会话编号无效');
    const viewer = await loadViewer(req.user, id);
    await postMessage(req, res, id, viewer.owner ? 'user' : 'staff');
}));

router.post('/conversations/:id/finish-handoff', endpoint('结束人工接待失败', async (req, res) => {
    const id = positiveId(req.params.id, '会话编号无效');
    const viewer = await loadViewer(req.user, id);
    if (!viewer.staff || viewer.owner) throw httpError(403, '需要客服管理权限');
    const [, { rows: [conversation] }] = await pool.batch([
        ['UPDATE support_chat_conversations SET human_requested = 0 WHERE id = ? AND human_requested = 1', [id]],
        [`${CONVERSATION_SQL} WHERE c.id = ?`, [id]]
    ]);
    if (!conversation) throw httpError(404, '客服会话不存在');
    res.json({ conversation: conversationDto(conversation), message: null });
}));

router.patch('/automation', endpoint('更新客服回复方式失败', async (req, res) => {
    const humanRequested = req.body?.humanRequested;
    if (typeof humanRequested !== 'boolean') throw httpError(400, '请选择有效的客服回复方式');
    if (humanRequested) {
        const result = await sendMessage(req.user, { body: '请求人工客服', humanHandoff: true });
        return res.json(result);
    }
    const [, { rows: [conversation] }] = await pool.batch([
        ['UPDATE support_chat_conversations SET human_requested = 0 WHERE user_id = ? AND human_requested = 1', [req.user.id]],
        [`${CONVERSATION_SQL} WHERE c.user_id = ?`, [req.user.id]]
    ]);
    res.json({ conversation: conversation ? conversationDto(conversation) : null, message: null });
}));

router.get('/conversations/:id/attachments/:attachmentId', endpoint('读取客服附件失败', async (req, res) => {
    const id = positiveId(req.params.id, '会话编号无效');
    const attachmentId = positiveId(req.params.attachmentId, '附件编号无效');
    await loadViewer(req.user, id);
    const [[attachment]] = await pool.query(
        `SELECT a.object_key, a.file_name, a.content_type, a.size
         FROM support_chat_attachments a JOIN support_chat_messages m ON m.id = a.message_id
         WHERE a.id = ? AND m.conversation_id = ?`,
        [attachmentId, id]
    );
    if (!attachment) throw httpError(404, '附件不存在');
    await streamPrivateAttachment(res, attachment);
}));

export default router;
