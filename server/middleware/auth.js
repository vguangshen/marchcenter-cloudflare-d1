// server/middleware/auth.js
import pool from "../config/db.js";
import { getJwtSecret } from "../config/env.js";
import { canManageUsers, isSuperAdmin, normalizeRole } from "../utils/roleAccess.js";
import { sessionTokenHash, verifyToken } from "../utils/token.js";
import { waitUntil } from "../config/runtime.js";
import { createLastSeenWriteTracker } from "../utils/lastSeenWriteTracker.js";

const lastSeenWriteTracker = createLastSeenWriteTracker();

// While an administrator reset is pending, the session may only read its own
// profile, set a new password or sign out. Everything else waits until then.
const PASSWORD_CHANGE_ALLOWED = new Set([
    'GET /api/auth/me',
    'HEAD /api/auth/me',
    'POST /api/auth/change-password',
    'POST /api/auth/logout'
]);

async function readSessionUser(userId, token) {
    const select = signedOut => `SELECT u.id, u.username, u.role, u.is_disabled, u.class_id,
                u.session_revoke_at, u.session_revoke_before,
                u.password_change_recommended,
                c.name AS class_name, t.username AS class_teacher_username,
                ${signedOut} AS session_signed_out
         FROM users u
         LEFT JOIN classes c ON c.id = u.class_id
         LEFT JOIN users t ON t.id = c.teacher_user_id
         WHERE u.id = ? LIMIT 1`;
    try {
        const [rows] = await pool.query(
            select('EXISTS (SELECT 1 FROM revoked_sessions rs WHERE rs.token_hash = ?)'),
            [await sessionTokenHash(token), userId]
        );
        return rows[0];
    } catch (error) {
        // A Worker deployed before migration 0046 must keep everyone signed in;
        // only server-side logout is unavailable until the table exists.
        if (error.code !== 'ER_NO_SUCH_TABLE' || !/revoked_sessions/.test(error.message)) throw error;
        console.error('revoked_sessions is missing; apply D1 migration 0046');
        const [rows] = await pool.query(select('0'), [userId]);
        return rows[0];
    }
}

export const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) return res.status(401).json({ error: "未登录" });

    let payload;
    try {
        payload = await verifyToken(token, getJwtSecret());
    } catch {
        return res.status(401).json({ error: "登录状态无效或已过期" });
    }

    try {
        const user = await readSessionUser(payload.id, token);
        if (!user || user.is_disabled) {
            return res.status(401).json({ error: user ? "账号已被禁用" : "用户不存在" });
        }
        const revokeAt = user.session_revoke_at ? new Date(user.session_revoke_at).getTime() : 0;
        const revokeBefore = user.session_revoke_before ? new Date(user.session_revoke_before).getTime() : 0;
        const sessionIssuedAt = Number(payload.issuedAtMs || Number(payload.iat || 0) * 1000);
        if (revokeAt && revokeBefore && Date.now() >= revokeAt && sessionIssuedAt < revokeBefore) {
            return res.status(401).json({ error: "登录会话已失效，请重新登录" });
        }
        if (Number(user.session_signed_out)) {
            return res.status(401).json({ error: "登录会话已退出，请重新登录" });
        }
        if (Number(user.password_change_recommended) && !PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.path}`)) {
            return res.status(403).json({ error: "请先修改登录密码", code: 'password_change_required' });
        }
        req.sessionToken = { value: token, expiresAt: Number(payload.exp) * 1000 };
        req.user = {
            id: user.id,
            username: user.username,
            role: normalizeRole(user.role),
            classId: user.class_id,
            className: user.class_name || null,
            classTeacherUsername: user.class_teacher_username || null,
            passwordChangeRecommended: Boolean(user.password_change_recommended)
        };
        // 最多每分钟更新一次在线状态，避免每个 API 请求都写数据库。
        const clientIp = req.ip;
        const userAgent = req.headers["user-agent"] || "";
        const now = Date.now();
        const isSsoDryRun = req.body?.dryRun === true
            && (req.path === '/api/sso/execute' || req.path === '/api/sso/execute/stream');
        if (!isSsoDryRun && lastSeenWriteTracker.shouldWrite(user.id, now)) {
            waitUntil(pool.query(
                "UPDATE users SET last_seen_at = NOW(), last_ip = ?, user_agent = ? WHERE id = ?",
                [clientIp, userAgent, user.id]
            ).catch(err => console.error("Update status error:", err)));
        }

        next();
    } catch (err) {
        console.error('Auth state database check failed:', err);
        return res.status(503).json({
            error: "登录服务暂时不可用，请稍后重试",
            code: 'auth_backend_unavailable'
        });
    }
};

export const adminOnly = (req, res, next) => {
    if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ error: "需要超级管理员权限" });
    }
    next();
};

export const userManagerOnly = (req, res, next) => {
    if (!canManageUsers(req.user)) {
        return res.status(403).json({ error: "需要用户管理权限" });
    }
    next();
};

export { getJwtSecret };
