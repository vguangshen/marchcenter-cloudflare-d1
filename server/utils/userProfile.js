import pool from '../config/db.js';
import { normalizeRole } from './roleAccess.js';

export const MAX_AVATAR_BYTES = 100 * 1024;
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/i;

export function normalizeAvatarDataUrl(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 64) {
        throw new Error('头像图片不能超过 100KB，请重新选择');
    }
    const match = AVATAR_DATA_URL.exec(value);
    if (!match) throw new Error('仅支持 PNG、JPEG、WebP、GIF 或 AVIF 图片');
    let bytes;
    try { bytes = atob(match[2]).length; }
    catch { throw new Error('头像图片数据无效，请重新选择'); }
    if (!bytes || bytes > MAX_AVATAR_BYTES) throw new Error('头像图片不能超过 100KB，请重新选择');
    return value;
}

export async function readUserProfile(userId) {
    const [rows] = await pool.query(
        `SELECT u.id, u.username, u.email, u.role, u.class_id, u.avatar_data_url,
                u.password_change_recommended,
                c.name AS class_name, t.username AS class_teacher_username
         FROM users u LEFT JOIN classes c ON c.id = u.class_id
         LEFT JOIN users t ON t.id = c.teacher_user_id WHERE u.id = ? LIMIT 1`,
        [userId]
    );
    const user = rows[0];
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        email: user.email || null,
        role: normalizeRole(user.role),
        classId: user.class_id ?? null,
        className: user.class_name || null,
        classTeacherUsername: user.class_teacher_username || null,
        avatarDataUrl: user.avatar_data_url || null,
        passwordChangeRecommended: Boolean(user.password_change_recommended)
    };
}
