import express from '../compat/express.js';
import pool from '../config/db.js';
import { waitUntil } from '../config/runtime.js';
import { authMiddleware } from '../middleware/auth.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { normalizeRole, ROLES } from '../utils/roleAccess.js';
import { readAttachmentForm, readAttachments, saveWithAttachments, streamPrivateAttachment } from '../utils/privateAttachments.js';
import { emailServiceState, readEmailSettings, sendTicketReplyEmail } from '../services/emailService.js';

const router = express.Router();

export const TICKET_CATEGORIES = Object.freeze(['open_failed', 'auto_login', 'score', 'account', 'card_display', 'other']);
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const STATUS_LABELS = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
const MAX_SUBJECT_LENGTH = 80;
const MAX_BODY_LENGTH = 5000;
const PAGE_SIZE = 20;
const MAX_ACTIVE_TICKETS = 20;
const MAX_TICKETS_PER_DAY = 10;
const TICKET_LIMITS_SQL = `SELECT
    COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS active,
    COUNT(*) FILTER (WHERE created_at > datetime('now', '-1 day')) AS recent
    FROM support_tickets WHERE user_id = ?`;
const OWNER_STATUS_TRANSITIONS = { open: ['resolved', 'closed'], closed: ['open', 'in_progress', 'resolved'] };
const TICKET_BY_ID_SQL = `SELECT t.*, u.username AS owner_username
    FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?`;

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function sendError(res, error, fallback) {
    const status = Number(error?.status);
    if (status >= 400 && status < 500) return res.status(status).json({ error: error.message || fallback });
    console.error(fallback, error);
    return res.status(500).json({ error: fallback });
}

const isStaff = user => [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(normalizeRole(user?.role));

// The previous statement must have written a row, and its last inserted ID
// must refer to the message. Materialize that ID before inserting any files.
function insertAttachments(uploaderId, files) {
    if (!files.length) return [];
    return [[
        `WITH message AS MATERIALIZED (
            SELECT id, ticket_id FROM support_ticket_messages WHERE id = last_insert_rowid() AND changes() > 0
         )
         INSERT INTO support_ticket_attachments (ticket_id, message_id, uploader_id, object_key, file_name, content_type, size)
         SELECT message.ticket_id, message.id, ?, json_extract(file.value, '$.key'), json_extract(file.value, '$.fileName'),
                json_extract(file.value, '$.contentType'), json_extract(file.value, '$.size')
         FROM message CROSS JOIN json_each(?) AS file`,
        [uploaderId, JSON.stringify(files)]
    ]];
}

async function assertTicketLimits(userId) {
    const [[{ active, recent }]] = await pool.query(TICKET_LIMITS_SQL, [userId]);
    if (active >= MAX_ACTIVE_TICKETS) throw httpError(429, '未解决的工单过多，请先等待处理或关闭部分工单');
    if (recent >= MAX_TICKETS_PER_DAY) throw httpError(429, '今天提交的工单已达上限，请明天再试');
}

function textField(form, name, maxLength) {
    const value = form.get(name);
    return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, maxLength + 1) : '';
}

function parseId(value) {
    if (!/^\d+$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Loads a ticket the viewer may see: its owner, or any administrator. */
async function loadTicket(user, id) {
    const ticketId = parseId(id);
    if (!ticketId) throw httpError(400, '工单编号无效');
    const [[ticket]] = await pool.query(TICKET_BY_ID_SQL, [ticketId]);
    const owner = ticket && Number(ticket.user_id) === Number(user.id);
    if (!ticket || (!owner && !isStaff(user))) throw httpError(404, '工单不存在');
    return { ticket, owner };
}

function publicTicket(row) {
    return {
        id: row.id,
        userId: row.user_id,
        ownerUsername: row.owner_username,
        competitionId: row.competition_id,
        cardTitle: row.card_title,
        category: row.category,
        subject: row.subject,
        status: row.status,
        userUnread: Number(row.user_unread || 0),
        staffUnread: Number(row.staff_unread || 0),
        lastMessage: row.last_message ?? undefined,
        lastAuthorRole: row.last_author_role ?? undefined,
        messageCount: row.message_count === undefined ? undefined : Number(row.message_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function notifyOwnerByEmail(ticket, reply) {
    waitUntil((async () => {
        const [[owner]] = await pool.query('SELECT username, email FROM users WHERE id = ? LIMIT 1', [ticket.user_id]);
        const to = String(owner?.email || '').trim();
        if (!to) return;
        const settings = await readEmailSettings();
        if (!emailServiceState(settings).ready) return;
        await sendTicketReplyEmail({ settings, to, username: owner.username, subject: ticket.subject, ticketId: ticket.id, reply });
    })().catch(error => console.error('Ticket reply email failed:', error)));
}

router.use(authMiddleware);

router.get('/unread', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const [[mine]] = await pool.query(
            'SELECT COUNT(*) AS count FROM support_tickets WHERE user_id = ? AND user_unread > 0',
            [req.user.id]
        );
        let staff = 0;
        if (isStaff(req.user)) {
            const [[row]] = await pool.query(
                "SELECT COUNT(*) AS count FROM support_tickets WHERE staff_unread > 0 AND user_id <> ? AND status IN ('open', 'in_progress')",
                [req.user.id]
            );
            staff = Number(row?.count || 0);
        }
        const own = Number(mine?.count || 0);
        res.json({ mine: own, staff, total: own + staff });
    } catch (error) {
        sendError(res, error, '读取工单提醒失败');
    }
});

router.get('/', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const scope = req.query.scope === 'all' ? 'all' : 'mine';
        if (scope === 'all' && !isStaff(req.user)) throw httpError(403, '只有管理员可以查看全部工单');
        const status = String(req.query.status || '');
        const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
        const where = [];
        const params = [];
        if (scope === 'mine') {
            where.push('t.user_id = ?');
            params.push(req.user.id);
        }
        if (status === 'active') where.push("t.status IN ('open', 'in_progress')");
        else if (STATUSES.includes(status)) {
            where.push('t.status = ?');
            params.push(status);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM support_tickets t ${whereSql}`, params);
        const [rows] = await pool.query(
            `SELECT t.*, u.username AS owner_username,
                    (SELECT substr(m.body, 1, 120) FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                    (SELECT m.author_role FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_author_role,
                    (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.author_role <> 'system') AS message_count
             FROM support_tickets t JOIN users u ON u.id = t.user_id
             ${whereSql}
             ORDER BY t.updated_at DESC, t.id DESC
             LIMIT ? OFFSET ?`,
            [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE]
        );
        res.json({
            tickets: rows.map(publicTicket),
            page,
            totalPages: Math.max(1, Math.ceil(Number(total) / PAGE_SIZE)),
            total: Number(total)
        });
    } catch (error) {
        sendError(res, error, '读取工单失败');
    }
});

router.post('/', async (req, res) => {
    try {
        const form = await readAttachmentForm(req.raw, '工单');
        const category = textField(form, 'category', 40);
        if (!TICKET_CATEGORIES.includes(category)) throw httpError(400, '请选择问题类型');
        const subject = textField(form, 'subject', MAX_SUBJECT_LENGTH).replace(/\s+/g, ' ');
        if (subject.length < 2) throw httpError(400, '标题至少 2 个字');
        if (subject.length > MAX_SUBJECT_LENGTH) throw httpError(400, `标题不能超过 ${MAX_SUBJECT_LENGTH} 个字`);
        const description = textField(form, 'description', MAX_BODY_LENGTH);
        if (description.length < 5) throw httpError(400, '请把问题描述得详细一些（至少 5 个字）');
        if (description.length > MAX_BODY_LENGTH) throw httpError(400, `问题描述不能超过 ${MAX_BODY_LENGTH} 个字`);

        let competitionId = null;
        let cardTitle = null;
        const rawCompetition = textField(form, 'competitionId', 20);
        if (rawCompetition) {
            competitionId = parseId(rawCompetition);
            if (!competitionId) throw httpError(400, '所选卡片无效');
            // Only a card the submitter can actually use may be attached.
            await assertCompetitionAccess(req.user, competitionId);
            const [[card]] = await pool.query('SELECT title FROM competitions WHERE id = ? LIMIT 1', [competitionId]);
            cardTitle = card?.title || null;
        }

        await assertTicketLimits(req.user.id);
        const files = await readAttachments(form);
        const ticketId = await saveWithAttachments('tickets', files, async uploaded => {
            const [created] = await pool.batch([
                [
                    `INSERT INTO support_tickets (user_id, competition_id, card_title, category, subject)
                     SELECT ?, ?, ?, ?, ? FROM (${TICKET_LIMITS_SQL}) WHERE active < ? AND recent < ?`,
                    [req.user.id, competitionId, cardTitle, category, subject, req.user.id, MAX_ACTIVE_TICKETS, MAX_TICKETS_PER_DAY]
                ],
                [
                    `INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body)
                     SELECT id, ?, 'user', ? FROM support_tickets WHERE id = last_insert_rowid() AND changes() > 0`,
                    [req.user.id, description]
                ],
                ...insertAttachments(req.user.id, uploaded)
            ]);
            if (!created.affectedRows) {
                await assertTicketLimits(req.user.id);
                throw httpError(429, '提交工单暂时受到频率限制，请稍后再试');
            }
            return created.insertId;
        });
        res.status(201).json({ message: '工单已提交，管理员会尽快处理', ticket: { id: ticketId } });
    } catch (error) {
        sendError(res, error, '提交工单失败');
    }
});

router.get('/:id', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const { ticket: { id }, owner } = await loadTicket(req.user, req.params.id);
        const unread = owner ? 'user_unread' : 'staff_unread';
        const [{ rows: messages }, { rows: attachments }, , { rows: [ticket] }] = await pool.batch([
            [
                `SELECT m.id, m.author_role, m.body, m.created_at, u.username AS author_username
                 FROM support_ticket_messages m LEFT JOIN users u ON u.id = m.author_id
                 WHERE m.ticket_id = ? ORDER BY m.id`,
                [id]
            ],
            [
                'SELECT id, message_id, file_name, content_type, size FROM support_ticket_attachments WHERE ticket_id = ? ORDER BY id',
                [id]
            ],
            [`UPDATE support_tickets SET ${unread} = 0 WHERE id = ? AND ${unread} > 0`, [id]],
            [TICKET_BY_ID_SQL, [id]]
        ]);
        if (!ticket) throw httpError(404, '工单不存在');
        const byMessage = new Map();
        for (const file of attachments) {
            const list = byMessage.get(file.message_id) || [];
            list.push({ id: file.id, fileName: file.file_name, contentType: file.content_type, size: Number(file.size) });
            byMessage.set(file.message_id, list);
        }
        res.json({
            ticket: publicTicket(ticket),
            viewer: { owner, staff: isStaff(req.user) },
            messages: messages.map(message => ({
                id: message.id,
                authorRole: message.author_role,
                authorUsername: message.author_username || null,
                body: message.body,
                createdAt: message.created_at,
                attachments: byMessage.get(message.id) || []
            }))
        });
    } catch (error) {
        sendError(res, error, '读取工单失败');
    }
});

router.post('/:id/messages', async (req, res) => {
    try {
        const { ticket, owner } = await loadTicket(req.user, req.params.id);
        if (ticket.status === 'closed') throw httpError(409, '工单已关闭，请先重新打开再回复');
        const form = await readAttachmentForm(req.raw, '工单');
        const body = textField(form, 'body', MAX_BODY_LENGTH);
        if (body.length > MAX_BODY_LENGTH) throw httpError(400, `回复不能超过 ${MAX_BODY_LENGTH} 个字`);
        const files = await readAttachments(form);
        if (!body && !files.length) throw httpError(400, '请输入回复内容或添加附件');
        const role = owner ? 'user' : 'staff';
        const unread = owner ? 'staff_unread' : 'user_unread';
        const [fromStatus, toStatus] = owner ? ['resolved', 'open'] : ['open', 'in_progress'];
        const status = await saveWithAttachments('tickets', files, async uploaded => {
            // Check the current status at the write, after parsing and staging files.
            const [message, updated] = await pool.batch([
                [
                    `INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body)
                     SELECT id, ?, ?, ? FROM support_tickets WHERE id = ? AND status <> 'closed'`,
                    [req.user.id, role, body, ticket.id]
                ],
                [
                    `UPDATE support_tickets SET ${unread} = ${unread} + 1,
                         status = CASE WHEN status = ? THEN ? ELSE status END, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ? AND changes() > 0 RETURNING status`,
                    [fromStatus, toStatus, ticket.id]
                ],
                ...insertAttachments(req.user.id, uploaded)
            ]);
            if (!message.affectedRows) {
                // The owner could have been deleted while the files were uploading.
                await loadTicket(req.user, ticket.id);
                throw httpError(409, '工单已关闭，请先重新打开再回复');
            }
            return updated.rows[0].status;
        });
        if (!owner) notifyOwnerByEmail(ticket, body || '（管理员发送了附件）');
        res.status(201).json({ message: '回复已发送', status });
    } catch (error) {
        sendError(res, error, '发送回复失败');
    }
});

router.patch('/:id/status', async (req, res) => {
    try {
        const { ticket, owner } = await loadTicket(req.user, req.params.id);
        const status = String(req.body?.status || '');
        if (!STATUSES.includes(status)) throw httpError(400, '工单状态无效');
        const staffActor = !owner && isStaff(req.user);
        const previousStates = staffActor ? STATUSES : (OWNER_STATUS_TRANSITIONS[status] || []);
        const actor = staffActor ? '管理员' : '提交人';
        const counter = staffActor ? ', user_unread = user_unread + 1' : status === 'open' ? ', staff_unread = staff_unread + 1' : '';
        const [updated, , current] = await pool.batch([
            [
                `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP${counter}
                 WHERE id = ? AND status <> ? AND status IN (?)`,
                [status, ticket.id, status, previousStates]
            ],
            [
                `INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body)
                 SELECT id, ?, 'system', ? FROM support_tickets WHERE id = ? AND changes() > 0`,
                [req.user.id, `${actor}将工单状态改为「${STATUS_LABELS[status]}」`, ticket.id]
            ],
            ['SELECT status FROM support_tickets WHERE id = ?', [ticket.id]]
        ]);
        if (!updated.affectedRows) {
            if (!current.rows.length) throw httpError(404, '工单不存在');
            if (current.rows[0].status === status) return res.json({ message: '状态未变化', status });
            throw httpError(403, '只能关闭或重新打开自己的工单');
        }
        res.json({ message: `工单已${STATUS_LABELS[status] === '待处理' ? '重新打开' : `标记为${STATUS_LABELS[status]}`}`, status });
    } catch (error) {
        sendError(res, error, '修改工单状态失败');
    }
});

router.get('/:id/attachments/:attachmentId', async (req, res) => {
    try {
        const { ticket } = await loadTicket(req.user, req.params.id);
        const attachmentId = parseId(req.params.attachmentId);
        if (!attachmentId) throw httpError(400, '附件编号无效');
        const [[attachment]] = await pool.query(
            'SELECT object_key, file_name, content_type, size FROM support_ticket_attachments WHERE id = ? AND ticket_id = ? LIMIT 1',
            [attachmentId, ticket.id]
        );
        if (!attachment) throw httpError(404, '附件不存在');
        await streamPrivateAttachment(res, attachment);
    } catch (error) {
        sendError(res, error, '读取附件失败');
    }
});

export default router;
