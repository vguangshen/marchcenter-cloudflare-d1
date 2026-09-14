import express from '../compat/express.js';
import pool from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { isSuperAdmin, normalizeRole } from '../utils/roleAccess.js';
import { CONTENT_TYPES, bumpContentRevision, getContentRevision } from '../utils/contentRevision.js';

const router = express.Router();
const ANNOUNCEMENT_TARGETS = new Set(['all', 'admin', 'teacher', 'student']);

function safeExternalLink(value, label) {
    if (!value) return null;
    let url;
    try { url = new URL(String(value)); } catch { throw new Error(`${label}格式无效`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label}仅支持 HTTP/HTTPS`);
    return url.toString();
}

function optionalIsoDate(value, label) {
    if (value === undefined || value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${label}格式无效`);
    return date.toISOString();
}

async function listAnnouncements(req) {
    const role = normalizeRole(req.user?.role);
    const where = isSuperAdmin(req.user) ? '' : 'WHERE target_type IN (?, ?)';
    const params = where ? ['all', role] : [];
    const [rows] = await pool.query(
        `SELECT id, title, content, link, duration, close_at AS closeAt,
                target_type AS targetType, created_at AS createdAt
         FROM announcements ${where} ORDER BY created_at DESC`,
        params
    );
    return rows;
}

async function listGifts(req) {
    const params = [];
    const where = isSuperAdmin(req.user) ? '' : 'WHERE g.target_user_id = ?';
    if (where) params.push(req.user.id);
    const [rows] = await pool.query(
        `SELECT g.id, g.target_user_id AS targetUserId, g.title, g.content, g.type,
                g.sent_at AS sentAt, g.is_read AS isRead, u.username AS recipientName
         FROM user_gifts g LEFT JOIN users u ON u.id = g.target_user_id
         ${where} ORDER BY g.sent_at DESC`,
        params
    );
    return rows.map(({ isRead, ...row }) => ({ ...row, read: Boolean(isRead) }));
}

router.get('/updates', authMiddleware, async (req, res) => {
    try {
        const [announcementRevision, giftRevision] = await Promise.all([
            getContentRevision(CONTENT_TYPES.announcements),
            getContentRevision(CONTENT_TYPES.gifts)
        ]);
        const announcementSince = String(req.query.announcementRevision || '');
        const giftSince = String(req.query.giftRevision || '');
        const announcementsChanged = announcementSince !== String(announcementRevision);
        const giftsChanged = giftSince !== String(giftRevision);
        const [announcements, gifts] = await Promise.all([
            announcementsChanged ? listAnnouncements(req) : null,
            giftsChanged ? listGifts(req) : null
        ]);
        res.json({
            announcements: {
                revision: announcementRevision,
                changed: announcementsChanged,
                ...(announcementsChanged ? { items: announcements } : {})
            },
            gifts: {
                revision: giftRevision,
                changed: giftsChanged,
                ...(giftsChanged ? { items: gifts } : {})
            },
            serverTime: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: '共享内容更新读取失败: ' + err.message });
    }
});

router.get('/announcements', authMiddleware, async (req, res) => {
    try {
        res.json(await listAnnouncements(req));
    } catch (err) {
        res.status(500).json({ error: '公告读取失败: ' + err.message });
    }
});

router.put('/announcements', authMiddleware, adminOnly, async (req, res) => {
    const announcements = Array.isArray(req.body) ? req.body : null;
    if (!announcements) return res.status(400).json({ error: '公告数据格式无效' });
    try {
        for (const item of announcements) {
            if (!item?.title || !item?.content) throw new Error('公告标题和内容不能为空');
            safeExternalLink(item.link, '公告链接');
            if (!ANNOUNCEMENT_TARGETS.has(item.targetType || 'all')) throw new Error('公告接收范围无效');
            optionalIsoDate(item.closeAt, '公告自动关闭时间');
        }
    } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
        const statements = [['DELETE FROM announcements', []]];
        for (const item of announcements) statements.push([
            `INSERT INTO announcements (id, title, content, link, duration, close_at, target_type, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [String(item.id).slice(0, 64), String(item.title).slice(0, 255), String(item.content).slice(0, 10000), safeExternalLink(item.link, '公告链接'),
                Math.min(3600, Math.max(0, Number(item.duration) || 0)), optionalIsoDate(item.closeAt, '公告自动关闭时间'), item.targetType || 'all',
                item.createdAt ? new Date(item.createdAt) : new Date()]
        ]);
        await pool.batch(statements);
        res.json({ success: true, announcements, revision: await bumpContentRevision(CONTENT_TYPES.announcements) });
    } catch (err) {
        res.status(500).json({ error: '公告保存失败: ' + err.message });
    }
});

router.get('/gifts', authMiddleware, async (req, res) => {
    try {
        res.json(await listGifts(req));
    } catch (err) {
        res.status(500).json({ error: '礼物读取失败: ' + err.message });
    }
});

router.post('/gifts', authMiddleware, adminOnly, async (req, res) => {
    const gifts = Array.isArray(req.body) ? req.body : null;
    if (!gifts?.length) return res.status(400).json({ error: '礼物数据不能为空' });
    try {
        for (const gift of gifts) {
            if (!gift?.title || !Number.isInteger(Number(gift.targetUserId))) throw new Error('礼物标题或接收用户无效');
            if (gift.type !== 'text') safeExternalLink(gift.content, '礼物链接');
        }
    } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
        const targetIds = [...new Set(gifts.map(gift => Number(gift.targetUserId)))];
        const [recipients] = await pool.query(
            "SELECT id FROM users WHERE id IN (?) AND role NOT IN ('super_admin', 'admin')",
            [targetIds]
        );
        const validIds = new Set(recipients.map(item => Number(item.id)));
        if (targetIds.some(id => !validIds.has(id))) throw new Error('礼物接收用户不存在或不可接收');
        await pool.batch(gifts.map(gift => [
            `INSERT INTO user_gifts (id, target_user_id, title, content, type, sent_at, is_read)
             VALUES (?, ?, ?, ?, ?, ?, 0)`,
            [String(gift.id).slice(0, 64), Number(gift.targetUserId), String(gift.title).slice(0, 255),
                gift.type === 'text' ? String(gift.content || '').slice(0, 10000) : safeExternalLink(gift.content, '礼物链接'),
                gift.type === 'text' ? 'text' : 'link', gift.sentAt ? new Date(gift.sentAt) : new Date()]
        ]));
        res.json({ success: true, gifts, revision: await bumpContentRevision(CONTENT_TYPES.gifts) });
    } catch (err) {
        res.status(500).json({ error: '礼物发送失败: ' + err.message });
    }
});

router.put('/gifts/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (!req.body.title) return res.status(400).json({ error: '礼物标题不能为空' });
        const content = req.body.type === 'text'
            ? String(req.body.content || '').slice(0, 10000)
            : safeExternalLink(req.body.content, '礼物链接');
        const [result] = await pool.query(
            'UPDATE user_gifts SET title = ?, content = ?, type = ? WHERE id = ?',
            [String(req.body.title).slice(0, 255), content, req.body.type === 'text' ? 'text' : 'link', req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: '礼物记录不存在' });
        res.json({ success: true, revision: await bumpContentRevision(CONTENT_TYPES.gifts) });
    } catch (err) {
        res.status(500).json({ error: '礼物更新失败: ' + err.message });
    }
});

router.delete('/gifts/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM user_gifts WHERE id = ?', [req.params.id]);
        res.json({ success: true, revision: result.affectedRows ? await bumpContentRevision(CONTENT_TYPES.gifts) : await getContentRevision(CONTENT_TYPES.gifts) });
    } catch (err) {
        res.status(500).json({ error: '礼物删除失败: ' + err.message });
    }
});

router.patch('/gifts/:id/read', authMiddleware, async (req, res) => {
    try {
        const [result] = await pool.query(
            'UPDATE user_gifts SET is_read = 1 WHERE id = ? AND target_user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: '礼物记录不存在' });
        res.json({ success: true, revision: await bumpContentRevision(CONTENT_TYPES.gifts) });
    } catch (err) {
        res.status(500).json({ error: '礼物状态更新失败: ' + err.message });
    }
});

export default router;
