import express from '../compat/express.js';
import pool from "../config/db.js";
import { authMiddleware, userManagerOnly } from "../middleware/auth.js";
import { getUserAccess, getUsersAccess } from "../utils/accessControl.js";
import {
    assignableRoles, canManageRole, canSeeUser, normalizeRole, ROLES
} from "../utils/roleAccess.js";
import { canSeeUserInClass, getActorWithClass } from "../utils/classAccess.js";
import { hashPassword } from "../utils/password.js";
import { CONTENT_TYPES, bumpContentRevision } from '../utils/contentRevision.js';
import { extractGeoFromRequest } from '../utils/geolocation.js';

const router = express.Router();
const RESET_PASSWORD = '123456';

// ==========================================
// 🟢 获取所有用户 (排序优化版)
// ==========================================
async function getManagedTarget(actor, targetId, { allowSelf = false } = {}) {
    const [rows] = await pool.query("SELECT id, username, role, class_id FROM users WHERE id = ?", [targetId]);
    if (!rows.length) {
        const error = new Error("用户不存在");
        error.status = 404;
        throw error;
    }
    const target = { ...rows[0], role: normalizeRole(rows[0].role) };
    if (Number(actor.id) === Number(target.id)) {
        if (allowSelf) return target;
        const error = new Error("不能对自己的账号执行该操作");
        error.status = 400;
        throw error;
    }
    if (!canManageRole(actor.role, target.role)) {
        const error = new Error("不能管理同级或更高级别的账号");
        error.status = 403;
        throw error;
    }
    const actorWithClass = await getActorWithClass(actor);
    if (!canSeeUserInClass(actorWithClass, target)) {
        const error = new Error("不能查看或管理其他班级的学生");
        error.status = 403;
        throw error;
    }
    return target;
}

const MAX_USER_BATCH_SIZE = 200;
const MAX_D1_BATCH_STATEMENTS = 900;
const USER_PAGE_SIZE_DEFAULT = 50;
const USER_PAGE_SIZE_MAX = 200;

function userPageParams(query) {
    const pageSize = Math.min(Math.max(Number(query?.pageSize) || USER_PAGE_SIZE_DEFAULT, 1), USER_PAGE_SIZE_MAX);
    const page = Math.max(Number(query?.page) || 1, 1);
    return { page, pageSize, offset: (page - 1) * pageSize };
}

function userVisibilityConditions(actor, search) {
    const conditions = [];
    const params = [];
    if (actor.role === ROLES.TEACHER) {
        conditions.push('(u.id = ? OR (u.role IN (?, ?) AND u.class_id = ?))');
        params.push(actor.id, ROLES.STUDENT, 'user', actor.class_id ?? null);
    } else if (actor.role === ROLES.ADMIN) {
        conditions.push('(u.id = ? OR u.role NOT IN (?, ?))');
        params.push(actor.id, ROLES.SUPER_ADMIN, ROLES.ADMIN);
    }
    const keyword = String(search || '').trim();
    if (keyword) {
        conditions.push('(lower(u.username) LIKE ? OR lower(u.email) LIKE ? OR lower(u.last_ip) LIKE ?)');
        const pattern = `%${keyword.toLowerCase()}%`;
        params.push(pattern, pattern, pattern);
    }
    return {
        where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params
    };
}

function httpError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function runBatchStatements(statements) {
    for (let index = 0; index < statements.length; index += MAX_D1_BATCH_STATEMENTS) {
        await pool.batch(statements.slice(index, index + MAX_D1_BATCH_STATEMENTS));
    }
}

async function createUsersBatch(actorUser, inputUsers) {
    if (!Array.isArray(inputUsers) || !inputUsers.length) throw httpError('用户数据不能为空');
    if (inputUsers.length > MAX_USER_BATCH_SIZE) throw httpError(`一次最多创建 ${MAX_USER_BATCH_SIZE} 个账号`);

    const actor = await getActorWithClass(actorUser);
    const allowedRoles = new Set(assignableRoles(actor.role));
    const names = new Set();
    const normalizedUsers = inputUsers.map((item, index) => {
        const normalizedUsername = String(item?.username || '').trim();
        const role = normalizeRole(item?.role);
        if (!normalizedUsername || normalizedUsername.length > 64 || typeof item?.password !== 'string' || item.password.length < 6 || item.password.length > 128) {
            throw httpError(`第 ${index + 1} 个账号的用户名或密码无效`);
        }
        if (!allowedRoles.has(role)) throw httpError(`不能创建第 ${index + 1} 个账号的角色`, 403);
        if (names.has(normalizedUsername)) throw httpError(`批量数据中存在重复用户名：${normalizedUsername}`, 409);
        names.add(normalizedUsername);
        return {
            username: normalizedUsername,
            email: item.email ? String(item.email).trim().slice(0, 255) : null,
            password: item.password,
            role,
            classId: role === ROLES.STUDENT
                ? actor.role === ROLES.TEACHER ? Number(actor.class_id) : Number(item.classId)
                : null
        };
    });

    const [existing] = await pool.query('SELECT username FROM users WHERE username IN (?)', [[...names]]);
    if (existing.length) throw httpError(`用户已存在：${existing.map(item => item.username).join('、')}`, 409);

    const studentClassIds = [...new Set(normalizedUsers.map(item => item.classId).filter(id => Number.isInteger(id) && id > 0))];
    if (normalizedUsers.some(item => item.role === ROLES.STUDENT && (!Number.isInteger(item.classId) || item.classId < 1))) {
        throw httpError('创建学生账号时必须选择所属班级');
    }
    const [classRows] = studentClassIds.length
        ? await pool.query('SELECT id FROM classes WHERE id IN (?)', [studentClassIds])
        : [[]];
    const validClassIds = new Set(classRows.map(item => Number(item.id)));
    const missingClassId = normalizedUsers.find(item => item.role === ROLES.STUDENT && !validClassIds.has(item.classId));
    if (missingClassId) throw httpError('所选班级不存在');

    const inheritedAccess = await getUserAccess(actor.id);
    let permissionIds = inheritedAccess.configured ? inheritedAccess.permissions : [];
    let inheritedTimeRules = inheritedAccess.timeRules || {};
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(actor.role)) {
        const [competitionRows] = await pool.query('SELECT id FROM competitions');
        permissionIds = competitionRows.map(item => Number(item.id));
        inheritedTimeRules = {};
    }
    const passwordHashes = await Promise.all(normalizedUsers.map(item => hashPassword(item.password)));
    const statements = [];
    normalizedUsers.forEach((item, index) => {
        statements.push([
            'INSERT INTO users (username, email, password_hash, role, class_id, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [item.username, item.email, passwordHashes[index], item.role, item.classId]
        ]);
        if (item.role === ROLES.TEACHER) {
            statements.push([
                `INSERT INTO classes (name, teacher_user_id, created_by)
                 VALUES (?, (SELECT id FROM users WHERE username = ?), ?)`,
                [item.username, item.username, actor.id]
            ]);
            statements.push([
                `UPDATE users SET class_id = (
                    SELECT id FROM classes WHERE teacher_user_id = (SELECT id FROM users WHERE username = ?)
                 ) WHERE username = ?`,
                [item.username, item.username]
            ]);
        }
        if ([ROLES.TEACHER, ROLES.STUDENT].includes(item.role)) {
            statements.push([
                `INSERT INTO user_access_policies (user_id, configured, updated_at)
                 VALUES ((SELECT id FROM users WHERE username = ?), 1, CURRENT_TIMESTAMP)
                 ON CONFLICT(user_id) DO UPDATE SET configured = 1, updated_at = CURRENT_TIMESTAMP`,
                [item.username]
            ]);
            for (const competitionId of permissionIds) {
                statements.push([
                    `INSERT OR IGNORE INTO user_permissions (user_id, competition_id)
                     VALUES ((SELECT id FROM users WHERE username = ?), ?)`,
                    [item.username, competitionId]
                ]);
                const rule = inheritedTimeRules[String(competitionId)] || {};
                if (rule.unlockTime || rule.lockTime) {
                    statements.push([
                        `INSERT INTO user_competition_time_rules
                            (user_id, competition_id, unlock_time, lock_time)
                          VALUES ((SELECT id FROM users WHERE username = ?), ?, ?, ?)`,
                        [item.username, competitionId, rule.unlockTime || null, rule.lockTime || null]
                    ]);
                }
            }
        }
    });
    await runBatchStatements(statements);
    const [createdRows] = await pool.query(
        `SELECT u.id, u.username, u.email, u.role, u.class_id AS classId, c.name AS className
         FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.username IN (?)`,
        [[...names]]
    );
    const createdByName = new Map(createdRows.map(item => [item.username, item]));
    return normalizedUsers.map(item => ({
        ...(createdByName.get(item.username) || {}),
        username: item.username,
        email: item.email,
        role: item.role
    }));
}

router.get("/", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const actor = await getActorWithClass(req.user);
        const { page, pageSize, offset } = userPageParams(req.query);
        const visibility = userVisibilityConditions(actor, req.query.search);
        const [[totalRows], [users]] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) AS count FROM users u ${visibility.where}`,
                visibility.params
            ),
            pool.query(`
                SELECT
                    u.id, u.username, u.email, u.role, u.is_disabled, u.created_at,
                    CASE WHEN u.last_login_at IS NULL THEN NULL
                         ELSE strftime('%Y-%m-%dT%H:%M:%fZ', u.last_login_at) END AS last_login_time,
                    CASE WHEN COALESCE(u.last_seen_at, u.last_login_at) IS NULL THEN NULL
                         ELSE strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(u.last_seen_at, u.last_login_at)) END AS last_active_time,
                    u.last_ip AS last_login_ip,
                    u.last_latitude, u.last_longitude,
                    u.last_city, u.last_country_code, u.last_region, u.last_timezone, u.last_organization,
                    u.user_agent, u.screen_resolution,
                    u.device_info, u.class_id,
                    c.name AS class_name,
                    c.teacher_user_id AS class_teacher_id
                FROM users u
                LEFT JOIN classes c ON c.id = u.class_id
                ${visibility.where}
                ORDER BY COALESCE(u.last_seen_at, u.last_login_at) DESC, u.id DESC
                LIMIT ? OFFSET ?
            `, [...visibility.params, pageSize, offset])
        ]);
        const total = Number(totalRows[0]?.count || 0);

        const visibleUsers = users
            .map(user => ({ ...user, role: normalizeRole(user.role) }))
            .filter(user => canSeeUser(actor, user) && canSeeUserInClass(actor, user));

        const accessByUser = await getUsersAccess(visibleUsers.map(user => user.id));
        for (let user of visibleUsers) {
            // D1 stores JSON values as text.
            if (typeof user.device_info === 'string') {
                try { user.device_info = JSON.parse(user.device_info); } catch { user.device_info = null; }
            }
            // 兼容设备信息
            if (!user.device_info && user.user_agent) {
                user.device_info = {
                    userAgent: user.user_agent,
                    screenResolution: user.screen_resolution
                };
            }

            const access = accessByUser.get(Number(user.id)) || { configured: false, permissions: [], timeRules: {} };
            user.permissions = access.permissions;
            user.timeRules = access.timeRules;
            user.permissionsConfigured = access.configured;
        }

        res.json({
            users: visibleUsers,
            total,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(total / pageSize))
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

router.get("/classes", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const actor = await getActorWithClass(req.user);
        const params = [];
        let where = '';
        if (actor.role === ROLES.TEACHER) {
            where = 'WHERE c.teacher_user_id = ?';
            params.push(actor.id);
        }
        const [classes] = await pool.query(
            `SELECT c.id, c.name, c.teacher_user_id AS teacherUserId,
                    u.username AS teacherUsername, COUNT(s.id) AS studentCount
             FROM classes c
             JOIN users u ON u.id = c.teacher_user_id
             LEFT JOIN users s ON s.class_id = c.id AND s.role IN ('student', 'user')
             ${where}
             GROUP BY c.id, c.name, c.teacher_user_id, u.username
             ORDER BY c.name`,
            params
        );
        res.json(classes.map(item => ({ ...item, studentCount: Number(item.studentCount) })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const [created] = await createUsersBatch(req.user, [req.body]);
        return res.json(created);
    } catch (err) {
        return res.status(err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: err.message });
    }
});

router.post('/batch', authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const created = await createUsersBatch(req.user, req.body?.users);
        return res.status(201).json({ success: true, count: created.length, users: created });
    } catch (err) {
        return res.status(err.status || (err.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: err.message });
    }
});

// ==========================================
// 🎨 主题设置
// ==========================================
router.get("/me/theme", authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT theme_settings FROM users WHERE id = ?", [req.user.id]);
        if (rows.length > 0 && rows[0].theme_settings) {
            const settings = typeof rows[0].theme_settings === 'string' ? JSON.parse(rows[0].theme_settings) : rows[0].theme_settings;
            res.json(settings);
        } else {
            res.json({
                effectMode: 'default',
                manualColor: 'blue',
                lightDark: 'light',
                immersive: null,
                backgroundMode: 'default',
                wallpaperId: null
            });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch("/me/theme", authMiddleware, async (req, res) => {
    try {
        await pool.query("UPDATE users SET theme_settings = ? WHERE id = ?", [JSON.stringify(req.body), req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 当前管理账号的密码重置会话策略。该偏好跟随账号保存，重新打开后台仍会回显。
router.get("/me/reset-session-policy", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const [[user]] = await pool.query(
            "SELECT reset_session_revoke_mode AS revokeMode FROM users WHERE id = ? LIMIT 1",
            [req.user.id]
        );
        const revokeMode = ['immediate', '1d', '7d'].includes(user?.revokeMode)
            ? user.revokeMode
            : 'immediate';
        res.json({ revokeMode });
    } catch (err) {
        res.status(500).json({ error: "读取会话策略失败: " + err.message });
    }
});

router.patch("/me/reset-session-policy", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const revokeMode = req.body?.revokeMode;
        if (!['immediate', '1d', '7d'].includes(revokeMode)) {
            return res.status(400).json({ error: '无效的旧会话撤销策略' });
        }
        await pool.query(
            "UPDATE users SET reset_session_revoke_mode = ? WHERE id = ?",
            [revokeMode, req.user.id]
        );
        res.json({ success: true, revokeMode });
    } catch (err) {
        res.status(500).json({ error: "保存会话策略失败: " + err.message });
    }
});

// ==========================================
// 🛠 用户管理操作
// ==========================================

async function deleteUsersBatch(actorUser, inputIds) {
    if (!Array.isArray(inputIds) || !inputIds.length) throw httpError('请选择要删除的用户');
    const normalizedIds = inputIds.map(value => Number(value));
    if (normalizedIds.some(id => !Number.isInteger(id) || id < 1)) throw httpError('批量删除的用户 ID 无效');
    const ids = [...new Set(normalizedIds)];
    if (ids.length > MAX_USER_BATCH_SIZE) throw httpError(`一次最多删除 ${MAX_USER_BATCH_SIZE} 个账号`);

    const actor = await getActorWithClass(actorUser);
    const [targets] = await pool.query(
        'SELECT id, username, role, class_id FROM users WHERE id IN (?)',
        [ids]
    );
    if (targets.length !== ids.length) {
        const existingIds = new Set(targets.map(item => Number(item.id)));
        const missing = ids.find(id => !existingIds.has(id));
        throw httpError(`用户 ${missing} 不存在`, 404);
    }
    const normalizedTargets = targets.map(target => ({ ...target, role: normalizeRole(target.role) }));
    for (const target of normalizedTargets) {
        if (Number(actor.id) === Number(target.id)) throw httpError('不能删除自己的账号');
        if (!canManageRole(actor.role, target.role)) throw httpError('不能管理同级或更高级别的账号', 403);
        if (!canSeeUserInClass(actor, target)) throw httpError('不能删除其他班级的学生', 403);
    }
    const teacherIds = normalizedTargets.filter(target => target.role === ROLES.TEACHER).map(target => target.id);
    if (teacherIds.length) {
        const [studentRows] = await pool.query(
            `SELECT c.teacher_user_id AS teacher_id, COUNT(s.id) AS student_count
             FROM classes c
             LEFT JOIN users s ON s.class_id = c.id AND s.role = 'student'
             WHERE c.teacher_user_id IN (?) GROUP BY c.teacher_user_id`,
            [teacherIds]
        );
        const occupied = new Set(studentRows.filter(row => Number(row.student_count) > 0).map(row => Number(row.teacher_id)));
        const blocked = normalizedTargets.find(target => occupied.has(Number(target.id)));
        if (blocked) throw httpError(`教师 ${blocked.username} 班级仍有学生，请先删除或转移班级学生`, 409);
    }

    const statements = [];
    for (const target of normalizedTargets) {
        statements.push(...[
            'DELETE FROM user_permissions WHERE user_id = ?',
            'DELETE FROM user_competition_time_rules WHERE user_id = ?',
            'DELETE FROM user_access_policies WHERE user_id = ?',
            'DELETE FROM user_workflow_status WHERE user_id = ?',
            'DELETE FROM user_platform_account_status WHERE user_id = ?',
            'DELETE FROM user_competition_student_accounts WHERE user_id = ?',
            'DELETE FROM user_competition_expert_student_bindings WHERE user_id = ?',
            'DELETE FROM user_competition_expert_accounts WHERE user_id = ?',
            'DELETE FROM user_manual_teacher_credentials WHERE user_id = ?',
            'DELETE FROM user_class_removals WHERE user_id = ?',
            'DELETE FROM login_verification_codes WHERE user_id = ?',
            'DELETE FROM user_gifts WHERE target_user_id = ?',
            'UPDATE logo_library SET created_by = NULL WHERE created_by = ?',
            'UPDATE wallpaper_library SET created_by = NULL WHERE created_by = ?'
        ].map(sql => [sql, [target.id]]));
        if (target.role === ROLES.TEACHER) statements.push(['DELETE FROM classes WHERE teacher_user_id = ?', [target.id]]);
        statements.push(['DELETE FROM users WHERE id = ?', [target.id]]);
    }
    await runBatchStatements(statements);
    await bumpContentRevision(CONTENT_TYPES.gifts);
    return ids;
}

router.delete('/batch', authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const deletedIds = await deleteUsersBatch(req.user, req.body?.userIds || req.body?.ids);
        return res.json({ success: true, count: deletedIds.length, userIds: deletedIds });
    } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
    }
});

// 删除用户
router.delete("/:id", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const target = await getManagedTarget(req.user, req.params.id);
        if (target.role === ROLES.TEACHER) {
            const [[classInfo]] = await pool.query(
                `SELECT c.id, COUNT(s.id) AS student_count
                 FROM classes c
                 LEFT JOIN users s ON s.class_id = c.id AND s.role = 'student'
                 WHERE c.teacher_user_id = ? GROUP BY c.id`,
                [target.id]
            );
            if (Number(classInfo?.student_count || 0) > 0) {
                const error = new Error("该教师班级仍有学生，请先删除或转移班级学生");
                error.status = 409;
                throw error;
            }
        }
        const statements = [
            "DELETE FROM user_permissions WHERE user_id = ?",
            "DELETE FROM user_competition_time_rules WHERE user_id = ?",
            "DELETE FROM user_access_policies WHERE user_id = ?",
            "DELETE FROM user_workflow_status WHERE user_id = ?",
            "DELETE FROM user_platform_account_status WHERE user_id = ?",
            "DELETE FROM user_competition_student_accounts WHERE user_id = ?",
            "DELETE FROM user_competition_expert_student_bindings WHERE user_id = ?",
            "DELETE FROM user_competition_expert_accounts WHERE user_id = ?",
            "DELETE FROM user_manual_teacher_credentials WHERE user_id = ?",
            "DELETE FROM user_class_removals WHERE user_id = ?",
            "DELETE FROM login_verification_codes WHERE user_id = ?",
            "DELETE FROM user_gifts WHERE target_user_id = ?",
            "UPDATE logo_library SET created_by = NULL WHERE created_by = ?",
            "UPDATE wallpaper_library SET created_by = NULL WHERE created_by = ?"
        ].map(sql => [sql, [req.params.id]]);
        if (target.role === ROLES.TEACHER) {
            statements.push(['DELETE FROM classes WHERE teacher_user_id = ?', [target.id]]);
        }
        statements.push(['DELETE FROM users WHERE id = ?', [req.params.id]]);
        await pool.batch(statements);
        res.json({ success: true, giftsRevision: await bumpContentRevision(CONTENT_TYPES.gifts) });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 禁用/启用
router.patch("/:id/status", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        await getManagedTarget(req.user, req.params.id);
        await pool.query("UPDATE users SET is_disabled = ? WHERE id = ?", [req.body.is_disabled ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch("/:id/class", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const actor = await getActorWithClass(req.user);
        if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(actor.role)) {
            return res.status(403).json({ error: "只有超级管理员或管理员可以调整学生班级" });
        }
        const target = await getManagedTarget(actor, req.params.id);
        if (target.role !== ROLES.STUDENT) return res.status(400).json({ error: "只能调整学生账号的班级" });
        const classId = Number(req.body?.classId);
        if (!Number.isInteger(classId) || classId < 1) return res.status(400).json({ error: "请选择有效班级" });
        const [[classRow]] = await pool.query('SELECT id, name FROM classes WHERE id = ? LIMIT 1', [classId]);
        if (!classRow) return res.status(404).json({ error: "班级不存在" });
        await pool.query('UPDATE users SET class_id = ? WHERE id = ?', [classId, target.id]);
        res.json({ success: true, classId, className: classRow.name });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// 保存用户的竞赛访问权限。未配置过的用户默认保持全部可见；一旦保存则按白名单执行。
router.patch("/:id/permissions", authMiddleware, userManagerOnly, async (req, res) => {
    const targetId = Number(req.params.id);
    const permissionIds = Array.isArray(req.body.permissions)
        ? [...new Set(req.body.permissions.map(Number).filter(id => Number.isInteger(id) && id > 0))]
        : [];
    const timeRules = req.body.timeRules && typeof req.body.timeRules === 'object' ? req.body.timeRules : {};
    if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: "用户参数无效" });

    try {
        const target = await getManagedTarget(req.user, targetId);
        if (![ROLES.TEACHER, ROLES.STUDENT].includes(target.role)) {
            const error = new Error("管理员账号默认拥有全部竞赛访问权限");
            error.status = 400;
            throw error;
        }
        const actor = await getActorWithClass(req.user);
        if (actor.role === ROLES.TEACHER) {
            const actorAccess = await getUserAccess(actor.id);
            if (!actorAccess.configured) {
                const error = new Error('教师账号尚未配置竞赛权限，不能向学生授权');
                error.status = 403;
                throw error;
            }
            const outsideScope = permissionIds.find(id => !actorAccess.permissions.includes(id));
            if (outsideScope) {
                const error = new Error('不能向学生授予教师本人没有的竞赛权限');
                error.status = 403;
                throw error;
            }
            for (const competitionId of permissionIds) {
                const childRule = timeRules[String(competitionId)] || timeRules[competitionId] || {};
                const parentRule = actorAccess.timeRules[String(competitionId)] || {};
                const childStart = childRule.unlockTime ? new Date(childRule.unlockTime).getTime() : null;
                const childEnd = childRule.lockTime ? new Date(childRule.lockTime).getTime() : null;
                const parentStart = parentRule.unlockTime ? new Date(parentRule.unlockTime).getTime() : null;
                const parentEnd = parentRule.lockTime ? new Date(parentRule.lockTime).getTime() : null;
                if ((parentStart && (!childStart || childStart < parentStart)) || (parentEnd && (!childEnd || childEnd > parentEnd))) {
                    const error = new Error('学生的开放时间不能超出教师本人可用时间');
                    error.status = 403;
                    throw error;
                }
            }
        }
        const [users] = await pool.query("SELECT id, role FROM users WHERE id = ?", [targetId]);
        if (!users.length) {
            return res.status(404).json({ error: "用户不存在" });
        }
        if ([ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(normalizeRole(users[0].role))) {
            return res.status(400).json({ error: "管理员账号不需要竞赛白名单" });
        }
        if (permissionIds.length) {
            const [cards] = await pool.query('SELECT id FROM competitions WHERE id IN (?)', [permissionIds]);
            if (cards.length !== permissionIds.length) return res.status(400).json({ error: '权限列表包含不存在的竞赛' });
        }
        const statements = [
            ["DELETE FROM user_permissions WHERE user_id = ?", [targetId]],
            ["DELETE FROM user_competition_time_rules WHERE user_id = ?", [targetId]]
        ];
        for (const competitionId of permissionIds) {
            statements.push([
                "INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?)",
                [targetId, competitionId]
            ]);
            const rule = timeRules[String(competitionId)] || timeRules[competitionId] || {};
            const unlockTime = rule.unlockTime ? new Date(rule.unlockTime) : null;
            const lockTime = rule.lockTime ? new Date(rule.lockTime) : null;
            if ((unlockTime && Number.isNaN(unlockTime.getTime())) || (lockTime && Number.isNaN(lockTime.getTime()))) {
                throw new Error(`竞赛 ${competitionId} 的时间格式无效`);
            }
            if (unlockTime && lockTime && unlockTime >= lockTime) {
                const error = new Error(`竞赛 ${competitionId} 的结束时间必须晚于开始时间`);
                error.status = 400;
                throw error;
            }
            if (unlockTime || lockTime) {
                statements.push([
                    "INSERT INTO user_competition_time_rules (user_id, competition_id, unlock_time, lock_time) VALUES (?, ?, ?, ?)",
                    [targetId, competitionId, unlockTime, lockTime]
                ]);
            }
        }
        statements.push([
            `INSERT INTO user_access_policies (user_id, configured, updated_at) VALUES (?, 1, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET configured = 1, updated_at = CURRENT_TIMESTAMP`,
            [targetId]
        ]);
        await pool.batch(statements);
        res.json({ success: true, permissions: permissionIds, timeRules, permissionsConfigured: true });
    } catch (err) {
        res.status(err.status || 500).json({ error: "权限保存失败: " + err.message });
    }
});

// 更新设备信息（登录后客户端上报；顺带按 request.cf 刷新来源地理位置）
router.patch("/:id/device", authMiddleware, async (req, res) => {
    const targetId = Number(req.params.id);
    const { userAgent, screenResolution } = req.body;
    try {
        if (req.user.id !== targetId) await getManagedTarget(req.user, targetId);
        const safeUserAgent = String(userAgent || '').slice(0, 1000);
        const safeResolution = String(screenResolution || '').slice(0, 64);
        const geo = extractGeoFromRequest(req);
        await pool.query(
            `UPDATE users SET user_agent = ?, screen_resolution = ?,
             last_latitude = ?, last_longitude = ?,
             last_city = ?, last_country_code = ?, last_region = ?, last_timezone = ?, last_organization = ?
             WHERE id = ?`,
            [safeUserAgent, safeResolution, geo.latitude, geo.longitude, geo.city, geo.countryCode, geo.region, geo.timezone, geo.organization, targetId]
        );
        try { await pool.query("UPDATE users SET device_info = JSON_SET(COALESCE(device_info, '{}'), '$.userAgent', ?, '$.screenResolution', ?) WHERE id = ?", [safeUserAgent, safeResolution, targetId]); } catch (e) {}
        res.json({ success: true });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// 登录位置历史：管理员查看某账号最近从哪些地点登录
router.get("/:id/locations", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        await getManagedTarget(req.user, req.params.id, { allowSelf: true });
        const [rows] = await pool.query(
            `SELECT id, latitude, longitude, city, country_code, region, timezone, organization, ip,
                    strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS created_at
             FROM user_login_locations
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 50`,
            [Number(req.params.id)]
        );
        res.json({ locations: rows });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// ==========================================
// 🔑 重置密码
// ==========================================
router.patch("/:id/reset-password", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        await getManagedTarget(req.user, req.params.id);
        const revokeBefore = new Date();
        const resetPassword = RESET_PASSWORD;
        const hashedPassword = await hashPassword(resetPassword);
        await pool.query(
            `UPDATE users
             SET password_hash = ?, session_revoke_before = ?, session_revoke_at = ?,
                 password_change_recommended = 1
             WHERE id = ?`,
            [hashedPassword, revokeBefore, revokeBefore, req.params.id]
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            success: true,
            message: '密码已重置为 123456，旧登录已立即撤销',
            resetPassword,
            passwordChangeRecommended: true
        });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: "重置失败: " + err.message });
    }
});

export default router;
