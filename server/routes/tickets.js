import express from '../compat/express.js';
import pool from '../config/db.js';
import { getEnv, waitUntil } from '../config/runtime.js';
import { authMiddleware } from '../middleware/auth.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { normalizeRole, ROLES } from '../utils/roleAccess.js';
import { emailServiceState, readEmailSettings, sendTicketReplyEmail } from '../services/emailService.js';

const router = express.Router();

export const TICKET_CATEGORIES = Object.freeze(['open_failed', 'auto_login', 'score', 'account', 'card_display', 'other']);
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const STATUS_LABELS = { open: '待处理', in_progress: '处理中', resolved: '已解决', closed: '已关闭' };
const MAX_FILES_PER_MESSAGE = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_TOTAL_BYTES = 20 * 1024 * 1024;
// Multipart framing and text fields on top of the file bytes.
export const MAX_TICKET_REQUEST_BYTES = MAX_FILES_TOTAL_BYTES + 512 * 1024;
const MAX_SUBJECT_LENGTH = 80;
const MAX_BODY_LENGTH = 5000;
const PAGE_SIZE = 20;
const MAX_ACTIVE_TICKETS = 20;
const MAX_TICKETS_PER_DAY = 10;

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

// Like the wallpaper upload, the byte cap is enforced while reading so a
// chunked body without Content-Length cannot be buffered in full first.
async function readTicketForm(request) {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) throw httpError(415, '请以表单方式提交工单');
    const body = request.body;
    if (!body) return request.formData();
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_TICKET_REQUEST_BYTES) {
                await reader.cancel();
                throw httpError(413, '附件合计不能超过 20MB');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: new Blob(chunks) }).formData();
}

function startsWith(bytes, signature, offset = 0) {
    if (bytes.length < offset + signature.length) return false;
    return signature.every((value, index) => bytes[offset + index] === value);
}

const ascii = text => [...text].map(char => char.charCodeAt(0));
const OFFICE_TYPES = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip'
};
const TEXT_TYPES = { txt: 'text/plain', log: 'text/plain', csv: 'text/csv' };

/**
 * Decides the stored type from the file's own bytes; the browser-supplied
 * type and the extension alone are never trusted. SVG, HTML and anything
 * else that could run script is rejected.
 */
export function detectAttachmentType(bytes, fileName) {
    const extension = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png', image: true };
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { type: 'image/jpeg', image: true };
    if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return { type: 'image/gif', image: true };
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { type: 'image/webp', image: true };
    if (startsWith(bytes, ascii('%PDF-'))) return { type: 'application/pdf', image: false };
    if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && OFFICE_TYPES[extension]) return { type: OFFICE_TYPES[extension], image: false };
    if (TEXT_TYPES[extension] && !bytes.includes(0)) {
        try {
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            return { type: `${TEXT_TYPES[extension]}; charset=utf-8`, image: false };
        } catch {
            return null;
        }
    }
    return null;
}

function cleanFileName(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim();
    if (!base) return 'attachment';
    if (base.length <= 120) return base;
    const extension = base.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || '';
    return `${base.slice(0, 120 - extension.length)}${extension}`;
}

async function readAttachments(form) {
    const files = form.getAll('files').filter(file => file && typeof file.arrayBuffer === 'function' && file.size > 0);
    if (files.length > MAX_FILES_PER_MESSAGE) throw httpError(400, `每次最多上传 ${MAX_FILES_PER_MESSAGE} 个附件`);
    let total = 0;
    const output = [];
    for (const file of files) {
        if (file.size > MAX_FILE_BYTES) throw httpError(413, `「${cleanFileName(file.name)}」超过 10MB`);
        total += file.size;
        if (total > MAX_FILES_TOTAL_BYTES) throw httpError(413, '附件合计不能超过 20MB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fileName = cleanFileName(file.name);
        const detected = detectAttachmentType(bytes, fileName);
        if (!detected) throw httpError(415, `「${fileName}」的格式不受支持，请上传图片、PDF、文本、ZIP、Word 或 Excel 文件`);
        output.push({ bytes, fileName, contentType: detected.type, size: bytes.byteLength });
    }
    return output;
}

function ticketBucket() {
    const bucket = getEnv('TICKET_FILES', null);
    if (!bucket || typeof bucket.put !== 'function') throw httpError(503, '附件存储暂不可用，请稍后再试');
    return bucket;
}

async function storeAttachments({ ticketId, messageId, uploaderId, files }) {
    if (!files.length) return [];
    const bucket = ticketBucket();
    const written = [];
    try {
        for (const file of files) {
            const key = `tickets/${ticketId}/${crypto.randomUUID()}`;
            await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.contentType } });
            written.push({ ...file, key });
        }
        const stored = [];
        for (const file of written) {
            const [result] = await pool.query(
                `INSERT INTO support_ticket_attachments (ticket_id, message_id, uploader_id, object_key, file_name, content_type, size)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [ticketId, messageId, uploaderId, file.key, file.fileName, file.contentType, file.size]
            );
            stored.push({ id: result.insertId, fileName: file.fileName, contentType: file.contentType, size: file.size });
        }
        return stored;
    } catch (error) {
        await Promise.allSettled(written.map(file => bucket.delete(file.key)));
        throw error;
    }
}

function textField(form, name, maxLength) {
    const value = form.get(name);
    return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, maxLength + 1) : '';
}

function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/** Loads a ticket the viewer may see: its owner, or any administrator. */
async function loadTicket(user, id) {
    const ticketId = parseId(id);
    if (!ticketId) throw httpError(400, '工单编号无效');
    const [[ticket]] = await pool.query(
        `SELECT t.*, u.username AS owner_username
         FROM support_tickets t JOIN users u ON u.id = t.user_id
         WHERE t.id = ? LIMIT 1`,
        [ticketId]
    );
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

async function addSystemMessage(ticketId, actorId, body) {
    await pool.query(
        "INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, 'system', ?)",
        [ticketId, actorId, body]
    );
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
        const form = await readTicketForm(req.raw);
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

        const [[limits]] = await pool.query(
            `SELECT
                SUM(CASE WHEN status IN ('open', 'in_progress') THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN created_at > datetime('now', '-1 day') THEN 1 ELSE 0 END) AS recent
             FROM support_tickets WHERE user_id = ?`,
            [req.user.id]
        );
        if (Number(limits?.active || 0) >= MAX_ACTIVE_TICKETS) throw httpError(429, '未解决的工单过多，请先等待处理或关闭部分工单');
        if (Number(limits?.recent || 0) >= MAX_TICKETS_PER_DAY) throw httpError(429, '今天提交的工单已达上限，请明天再试');

        const files = await readAttachments(form);
        if (files.length) ticketBucket();

        const [ticketResult] = await pool.query(
            'INSERT INTO support_tickets (user_id, competition_id, card_title, category, subject) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, competitionId, cardTitle, category, subject]
        );
        const ticketId = ticketResult.insertId;
        try {
            const [messageResult] = await pool.query(
                "INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, 'user', ?)",
                [ticketId, req.user.id, description]
            );
            await storeAttachments({ ticketId, messageId: messageResult.insertId, uploaderId: req.user.id, files });
        } catch (error) {
            await pool.query('DELETE FROM support_tickets WHERE id = ?', [ticketId]).catch(() => {});
            throw error;
        }
        res.status(201).json({ message: '工单已提交，管理员会尽快处理', ticket: { id: ticketId } });
    } catch (error) {
        sendError(res, error, '提交工单失败');
    }
});

router.get('/:id', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        const { ticket, owner } = await loadTicket(req.user, req.params.id);
        const [[messages], [attachments]] = await Promise.all([
            pool.query(
                `SELECT m.id, m.author_role, m.body, m.created_at, u.username AS author_username
                 FROM support_ticket_messages m LEFT JOIN users u ON u.id = m.author_id
                 WHERE m.ticket_id = ? ORDER BY m.id`,
                [ticket.id]
            ),
            pool.query(
                'SELECT id, message_id, file_name, content_type, size FROM support_ticket_attachments WHERE ticket_id = ? ORDER BY id',
                [ticket.id]
            )
        ]);
        if (owner && Number(ticket.user_unread)) {
            await pool.query('UPDATE support_tickets SET user_unread = 0 WHERE id = ?', [ticket.id]);
            ticket.user_unread = 0;
        } else if (!owner && Number(ticket.staff_unread)) {
            await pool.query('UPDATE support_tickets SET staff_unread = 0 WHERE id = ?', [ticket.id]);
            ticket.staff_unread = 0;
        }
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
        const form = await readTicketForm(req.raw);
        const body = textField(form, 'body', MAX_BODY_LENGTH);
        if (body.length > MAX_BODY_LENGTH) throw httpError(400, `回复不能超过 ${MAX_BODY_LENGTH} 个字`);
        const files = await readAttachments(form);
        if (!body && !files.length) throw httpError(400, '请输入回复内容或添加附件');
        if (files.length) ticketBucket();

        const role = owner ? 'user' : 'staff';
        const [messageResult] = await pool.query(
            'INSERT INTO support_ticket_messages (ticket_id, author_id, author_role, body) VALUES (?, ?, ?, ?)',
            [ticket.id, req.user.id, role, body]
        );
        try {
            await storeAttachments({ ticketId: ticket.id, messageId: messageResult.insertId, uploaderId: req.user.id, files });
        } catch (error) {
            await pool.query('DELETE FROM support_ticket_messages WHERE id = ?', [messageResult.insertId]).catch(() => {});
            throw error;
        }
        let status = ticket.status;
        if (owner) {
            // A reply to a resolved ticket means the problem is not solved yet.
            if (status === 'resolved') status = 'open';
            await pool.query(
                'UPDATE support_tickets SET staff_unread = staff_unread + 1, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [status, ticket.id]
            );
        } else {
            if (status === 'open') status = 'in_progress';
            await pool.query(
                'UPDATE support_tickets SET user_unread = user_unread + 1, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [status, ticket.id]
            );
            notifyOwnerByEmail(ticket, body || '（管理员发送了附件）');
        }
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
        if (status === ticket.status) return res.json({ message: '状态未变化', status });
        const staffActor = !owner && isStaff(req.user);
        if (!staffActor) {
            const allowed = status === 'closed' || (status === 'open' && ['resolved', 'closed'].includes(ticket.status));
            if (!allowed) throw httpError(403, '只能关闭或重新打开自己的工单');
        }
        const actor = staffActor ? '管理员' : '提交人';
        await addSystemMessage(ticket.id, req.user.id, `${actor}将工单状态改为「${STATUS_LABELS[status]}」`);
        const counter = staffActor ? 'user_unread = user_unread + 1' : (status === 'open' ? 'staff_unread = staff_unread + 1' : 'staff_unread = staff_unread');
        await pool.query(
            `UPDATE support_tickets SET status = ?, ${counter}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [status, ticket.id]
        );
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
        const object = await ticketBucket().get(attachment.object_key);
        if (!object) throw httpError(404, '附件文件已丢失');
        const image = String(attachment.content_type).startsWith('image/');
        const encodedName = encodeURIComponent(attachment.file_name);
        res.status(200).stream(object.body, {
            'Content-Type': attachment.content_type,
            'Content-Length': String(attachment.size),
            'Content-Disposition': `${image ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodedName}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox"
        });
    } catch (error) {
        sendError(res, error, '读取附件失败');
    }
});

export default router;
