import express from '../compat/express.js';
import pool from "../config/db.js";
import { authMiddleware, userManagerOnly } from "../middleware/auth.js";
import { getUserAccess, getUsersAccess } from "../utils/accessControl.js";
import {
    assignableRoles, canManageRole, canSeeUser, normalizeRole, ROLES
} from "../utils/roleAccess.js";
import { canSeeUserInClass, getActorWithClass } from "../utils/classAccess.js";
import {
    ADMIN_RESET_DEFAULT_PASSWORD, PASSWORD_CHANGE_GRACE_DAYS, hashPassword, passwordChangeDeadline
} from "../utils/password.js";
import { CONTENT_TYPES } from '../utils/contentRevision.js';
import { extractGeoFromRequest } from '../utils/geolocation.js';
import { normalizeAvatarDataUrl, readUserProfile } from '../utils/userProfile.js';

const router = express.Router();
const RESET_REVOKE_DELAYS_MS = Object.freeze({ immediate: 0, '1d': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 });

router.patch('/me/profile', authMiddleware, async (req, res) => {
    if (!Object.hasOwn(req.body || {}, 'avatarDataUrl')) {
        return res.status(400).json({ error: '请选择需要保存的个人头像' });
    }
    let avatarDataUrl;
    try { avatarDataUrl = normalizeAvatarDataUrl(req.body.avatarDataUrl); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
        await pool.query('UPDATE users SET avatar_data_url = ? WHERE id = ?', [avatarDataUrl, req.user.id]);
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ user: await readUserProfile(req.user.id) });
    } catch (error) {
        console.error('Profile update failed:', error.message);
        return res.status(500).json({ error: '个人资料保存失败，请稍后重试' });
    }
});

// Accounts created without an email can bind one themselves. Changing an
// address that is already bound stays with administrators, so a borrowed
// session cannot redirect password-reset and code-login mail.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
router.patch('/me/email', authMiddleware, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
        return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    try {
        const [[current]] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [req.user.id]);
        if (!current) return res.status(404).json({ error: '用户不存在' });
        if (String(current.email || '').trim()) {
            return res.status(409).json({ error: '账号已绑定邮箱，如需更换请联系管理员' });
        }
        const [taken] = await pool.query(
            'SELECT id FROM users WHERE id <> ? AND (lower(email) = lower(?) OR lower(username) = lower(?)) LIMIT 1',
            [req.user.id, email, email]
        );
        if (taken.length) return res.status(409).json({ error: '该邮箱已被其他账号使用' });
        const [result] = await pool.query(
            "UPDATE users SET email = ? WHERE id = ? AND (email IS NULL OR trim(email) = '')",
            [email, req.user.id]
        );
        if (!result.affectedRows) return res.status(409).json({ error: '邮箱状态已更新，请刷新后重试' });
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ user: await readUserProfile(req.user.id) });
    } catch (error) {
        if (/UNIQUE/i.test(error.message || '')) return res.status(409).json({ error: '该邮箱已被其他账号使用' });
        console.error('Email binding failed:', error.message);
        return res.status(500).json({ error: '邮箱绑定失败，请稍后重试' });
    }
});

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
// Pass large lists as one JSON parameter so D1's 100 bound-parameter limit
// never depends on how many users or competitions an administrator selected.
const jsonList = values => JSON.stringify([...values]);
// D1 limits each individual prepared statement to 100 bound parameters.
const MAX_D1_BOUND_PARAMETERS = 100;
const USER_PAGE_SIZE_DEFAULT = 50;
const USER_PAGE_SIZE_MAX = 200;

function userPageParams(query) {
    const pageSize = Math.min(Math.max(Number(query?.pageSize) || USER_PAGE_SIZE_DEFAULT, 1), USER_PAGE_SIZE_MAX);
    const page = Math.max(Number(query?.page) || 1, 1);
    return { page, pageSize, offset: (page - 1) * pageSize };
}

function userVisibility(actor) {
    if (actor.role === ROLES.TEACHER) {
        return { sql: "(u.id = ? OR (u.role IN ('student', 'user') AND u.class_id = ?))", params: [actor.id, actor.class_id] };
    }
    const hiddenRoles = actor.role === ROLES.ADMIN ? [ROLES.SUPER_ADMIN, ROLES.ADMIN] : [ROLES.SUPER_ADMIN];
    return { sql: '(u.id = ? OR u.role NOT IN (?))', params: [actor.id, hiddenRoles] };
}

function userSearch(search) {
    const keyword = String(search || '').trim();
    if (!keyword) return { sql: '1', params: [] };
    const pattern = `%${keyword.toLowerCase()}%`;
    return {
        sql: '(lower(u.username) LIKE ? OR lower(u.email) LIKE ? OR lower(u.last_ip) LIKE ?)',
        params: [pattern, pattern, pattern]
    };
}

function httpError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function userIdChunks(ids) {
    const chunks = [];
    for (let index = 0; index < ids.length; index += MAX_D1_BOUND_PARAMETERS) {
        chunks.push(ids.slice(index, index + MAX_D1_BOUND_PARAMETERS));
    }
    return chunks;
}

async function deleteUsersAtomically(statements) {
    const results = await pool.batch([
        ...statements,
        [`INSERT INTO content_revisions (content_type, revision, updated_at)
          VALUES (?, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(content_type) DO UPDATE SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP`,
        [CONTENT_TYPES.gifts]],
        ['SELECT revision FROM content_revisions WHERE content_type = ?', [CONTENT_TYPES.gifts]]
    ]);
    return Number(results.at(-1)?.rows?.[0]?.revision || 0);
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
        const hasPermissions = Object.hasOwn(item, 'permissions');
        const hasTimeRules = Object.hasOwn(item, 'timeRules');
        if ((hasPermissions || hasTimeRules) && ![ROLES.TEACHER, ROLES.STUDENT].includes(role)) {
            throw httpError('管理员账号默认拥有全部竞赛访问权限');
        }
        let permissions = null;
        if (hasPermissions) {
            if (!Array.isArray(item.permissions)) throw httpError(`第 ${index + 1} 个账号的权限列表格式无效`);
            permissions = item.permissions.map(Number);
            if (permissions.some(id => !Number.isInteger(id) || id < 1)) {
                throw httpError(`第 ${index + 1} 个账号的权限列表格式无效`);
            }
            permissions = [...new Set(permissions)];
        }
        if (hasTimeRules && (!item.timeRules || typeof item.timeRules !== 'object' || Array.isArray(item.timeRules))) {
            throw httpError(`第 ${index + 1} 个账号的时间规则格式无效`);
        }
        names.add(normalizedUsername);
        return {
            username: normalizedUsername,
            email: item.email ? String(item.email).trim().slice(0, 255) : null,
            password: item.password,
            role,
            permissions,
            timeRules: hasTimeRules ? item.timeRules : null,
            hasAccessInput: hasPermissions || hasTimeRules,
            classId: role === ROLES.STUDENT
                ? actor.role === ROLES.TEACHER ? Number(actor.class_id) : Number(item.classId)
                : null
        };
    });

    const [existing] = await pool.query('SELECT username FROM users WHERE username IN (SELECT value FROM json_each(?))', [jsonList(names)]);
    if (existing.length) throw httpError(`用户已存在：${existing.map(item => item.username).join('、')}`, 409);

    const studentClassIds = [...new Set(normalizedUsers.map(item => item.classId).filter(id => Number.isInteger(id) && id > 0))];
    if (normalizedUsers.some(item => item.role === ROLES.STUDENT && (!Number.isInteger(item.classId) || item.classId < 1))) {
        throw httpError('创建学生账号时必须选择所属班级');
    }
    const [classRows] = studentClassIds.length
        ? await pool.query('SELECT id FROM classes WHERE id IN (SELECT value FROM json_each(?))', [jsonList(studentClassIds)])
        : [[]];
    const validClassIds = new Set(classRows.map(item => Number(item.id)));
    const missingClassId = normalizedUsers.find(item => item.role === ROLES.STUDENT && !validClassIds.has(item.classId));
    if (missingClassId) throw httpError('所选班级不存在');

    const [inheritedAccess, [competitionRows]] = await Promise.all([
        getUserAccess(actor.id), pool.query('SELECT id FROM competitions')
    ]);
    const availableIds = new Set(competitionRows.map(item => Number(item.id)));
    const privilegedActor = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(actor.role);
    const defaultPermissions = privilegedActor ? [...availableIds]
        : inheritedAccess.configured ? inheritedAccess.permissions : [];
    const defaultTimeRules = privilegedActor ? {} : inheritedAccess.timeRules || {};
    for (const item of normalizedUsers) {
        if (![ROLES.TEACHER, ROLES.STUDENT].includes(item.role)) continue;
        // Omission retains the legacy inheritance contract. An explicit empty
        // list is a configured empty whitelist, never an instruction to inherit.
        item.permissions = item.permissions ?? defaultPermissions;
        if (item.permissions.some(id => !availableIds.has(id))) throw httpError('权限列表包含不存在的竞赛');
        if (actor.role === ROLES.TEACHER && item.hasAccessInput && !inheritedAccess.configured) {
            throw httpError('教师账号尚未配置竞赛权限，不能向学生授权', 403);
        }
        if (actor.role === ROLES.TEACHER && item.permissions.some(id => !inheritedAccess.permissions.includes(id))) {
            throw httpError('不能向学生授予教师本人没有的竞赛权限', 403);
        }
        const inputRules = item.timeRules ?? defaultTimeRules;
        const normalizedRules = {};
        for (const competitionId of item.permissions) {
            const rule = inputRules[String(competitionId)] || {};
            if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
                throw httpError(`竞赛 ${competitionId} 的时间规则格式无效`);
            }
            const unlockTime = rule.unlockTime ? new Date(rule.unlockTime) : null;
            const lockTime = rule.lockTime ? new Date(rule.lockTime) : null;
            if ((unlockTime && Number.isNaN(unlockTime.getTime())) || (lockTime && Number.isNaN(lockTime.getTime()))) {
                throw httpError(`竞赛 ${competitionId} 的时间格式无效`);
            }
            if (unlockTime && lockTime && unlockTime >= lockTime) {
                throw httpError(`竞赛 ${competitionId} 的结束时间必须晚于开始时间`);
            }
            if (actor.role === ROLES.TEACHER) {
                const parent = inheritedAccess.timeRules[String(competitionId)] || {};
                const parentStart = parent.unlockTime ? new Date(parent.unlockTime).getTime() : null;
                const parentEnd = parent.lockTime ? new Date(parent.lockTime).getTime() : null;
                if ((parentStart && (!unlockTime || unlockTime.getTime() < parentStart))
                    || (parentEnd && (!lockTime || lockTime.getTime() > parentEnd))) {
                    throw httpError('学生的开放时间不能超出教师本人可用时间', 403);
                }
            }
            if (unlockTime || lockTime) normalizedRules[String(competitionId)] = { unlockTime, lockTime };
        }
        item.timeRules = normalizedRules;
    }
    const passwordHashes = await Promise.all(normalizedUsers.map(item => hashPassword(item.password)));
    const changeDeadline = passwordChangeDeadline();
    const statements = [];
    normalizedUsers.forEach((item, index) => {
        // The creator knows the initial password, so the new owner is reminded
        // to replace it and is locked once the grace period ends, like a reset.
        statements.push([
            `INSERT INTO users (username, email, password_hash, role, class_id,
                                password_change_recommended, password_change_deadline, created_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)`,
            [item.username, item.email, passwordHashes[index], item.role, item.classId, changeDeadline]
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
            for (const competitionId of item.permissions) {
                statements.push([
                    `INSERT OR IGNORE INTO user_permissions (user_id, competition_id)
                     VALUES ((SELECT id FROM users WHERE username = ?), ?)`,
                    [item.username, competitionId]
                ]);
                const rule = item.timeRules[String(competitionId)] || {};
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
    // D1 batch is transactional. Keep account, class and selected access rules
    // in one transaction so a later failure cannot leave over-permitted users.
    await pool.batch(statements);
    const [createdRows] = await pool.query(
        `SELECT u.id, u.username, u.email, u.role, u.class_id AS classId, c.name AS className
         FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.username IN (SELECT value FROM json_each(?))`,
        [jsonList(names)]
    );
    const createdByName = new Map(createdRows.map(item => [item.username, item]));
    return normalizedUsers.map(item => ({
        ...(createdByName.get(item.username) || {}),
        username: item.username,
        email: item.email,
        role: item.role
    }));
}

const USER_LIST_FIELDS = `u.id, u.username, u.email, u.role, u.is_disabled, u.created_at,
    strftime('%Y-%m-%dT%H:%M:%fZ', u.last_login_at) AS last_login_time,
    strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(u.last_seen_at, u.last_login_at)) AS last_active_time,
    u.last_ip AS last_login_ip, u.last_latitude, u.last_longitude, u.last_city, u.last_country_code,
    u.last_region, u.last_timezone, u.last_organization, u.user_agent, u.screen_resolution,
    u.device_info, u.class_id, c.name AS class_name, c.teacher_user_id AS class_teacher_id`;
const USER_LIST_FROM = 'FROM users u LEFT JOIN classes c ON c.id = u.class_id';
const USER_ACTIVITY_ORDER = 'COALESCE(u.last_seen_at, u.last_login_at) DESC, u.id DESC';

// Resolve class ownership over the entire visible directory before paging the roots.
// A missing class or inaccessible owner leaves the student visible as an independent row.
async function readUserGroups(visibility, search, { pageSize, offset }) {
    const groups = `WITH visible AS (
            SELECT u.id, u.role, u.class_id, CASE WHEN ${search.sql} THEN 1 ELSE 0 END AS matched
            FROM users u WHERE ${visibility.sql}
        ), members AS (
            SELECT account.id, COALESCE(teacher.id, account.id) AS rootId, account.matched
            FROM visible account
            LEFT JOIN classes owned ON owned.id = account.class_id AND account.role IN ('student', 'user')
            LEFT JOIN visible teacher ON teacher.id = owned.teacher_user_id AND teacher.role = 'teacher'
        ), groups AS (
            SELECT rootId, COUNT(*) - 1 AS studentCount, SUM(matched) AS matches,
                   SUM(CASE WHEN id <> rootId THEN matched ELSE 0 END) AS matchingStudentCount
            FROM members GROUP BY rootId HAVING SUM(matched) > 0
        )`;
    const params = [...search.params, ...visibility.params];
    const [counts, rows] = await pool.batch([
        [`${groups} SELECT COUNT(*) AS rootCount, COALESCE(SUM(matches), 0) AS total FROM groups`, params],
        [`${groups} SELECT ${USER_LIST_FIELDS}, g.studentCount, g.matchingStudentCount
         ${USER_LIST_FROM} JOIN groups g ON g.rootId = u.id
         ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END,
                  ${USER_ACTIVITY_ORDER} LIMIT ? OFFSET ?`, [...params, pageSize, offset]]
    ]);
    return { users: rows.rows, ...counts.rows[0] };
}

async function readUserPage(visibility, search, { pageSize, offset }, query, actor) {
    const conditions = [visibility.sql, search.sql];
    const params = [...visibility.params, ...search.params];
    if (query.teacherId !== undefined) {
        const teacherId = Number(query.teacherId);
        if (!Number.isSafeInteger(teacherId) || teacherId <= 0) throw httpError('无效的教师账号');
        if (actor.role === ROLES.TEACHER && teacherId !== Number(actor.id)) throw httpError('不能查看其他教师的学生', 403);
        conditions.push("u.role IN ('student', 'user') AND c.teacher_user_id = ?");
        params.push(teacherId);
    }
    if (query.view === 'candidates') {
        conditions.push('u.id <> ?');
        params.push(actor.id);
    }
    const from = `${USER_LIST_FROM} WHERE ${conditions.join(' AND ')}`;
    const fields = query.view === 'candidates' ? 'u.id, u.username, u.email, u.role, u.class_id' : USER_LIST_FIELDS;
    const [counts, rows] = await pool.batch([
        [`SELECT COUNT(*) AS total ${from}`, params],
        [`SELECT ${fields} ${from} ORDER BY ${USER_ACTIVITY_ORDER} LIMIT ? OFFSET ?`, [...params, pageSize, offset]]
    ]);
    return { users: rows.rows, total: counts.rows[0].total, rootCount: counts.rows[0].total };
}

router.get("/", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const actor = await getActorWithClass(req.user);
        const pagination = userPageParams(req.query);
        const visibility = userVisibility(actor);
        const search = userSearch(req.query.search);
        const { users, total, rootCount } = req.query.view === 'hierarchy'
            ? await readUserGroups(visibility, search, pagination)
            : await readUserPage(visibility, search, pagination, req.query, actor);

        const visibleUsers = users
            .map(user => ({ ...user, role: normalizeRole(user.role) }))
            .filter(user => canSeeUser(actor, user) && canSeeUserInClass(actor, user));

        if (req.query.view !== 'candidates') {
            await attachUserListDetails(visibleUsers);
        }

        res.json({
            users: visibleUsers,
            total,
            page: pagination.page,
            pageSize: pagination.pageSize,
            totalPages: Math.max(1, Math.ceil(rootCount / pagination.pageSize))
        });
    } catch (err) {
        if (!err.status) console.error(err);
        res.status(err.status || 500).json({ error: err.message });
    }
});

async function attachUserListDetails(visibleUsers) {
    const accessByUser = await getUsersAccess(visibleUsers.map(user => user.id));
    for (const user of visibleUsers) {
        if (typeof user.device_info === 'string') {
            try { user.device_info = JSON.parse(user.device_info); } catch { user.device_info = null; }
        }
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
}

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

const MAX_THEME_SETTINGS_BYTES = 16 * 1024;

router.patch("/me/theme", authMiddleware, async (req, res) => {
    const settings = req.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: '主题设置格式无效' });
    }
    const serialized = JSON.stringify(settings);
    if (new TextEncoder().encode(serialized).byteLength > MAX_THEME_SETTINGS_BYTES) {
        return res.status(413).json({ error: '主题设置内容过大' });
    }
    try {
        await pool.query("UPDATE users SET theme_settings = ? WHERE id = ?", [serialized, req.user.id]);
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

async function findOccupiedTeacher(teacherIds) {
    if (!teacherIds.length) return null;
    const [[teacher]] = await pool.query(
        `SELECT t.username FROM users t JOIN classes c ON c.teacher_user_id = t.id
         WHERE t.id IN (SELECT value FROM json_each(?))
           AND EXISTS (SELECT 1 FROM users s WHERE s.class_id = c.id AND s.role IN ('student', 'user'))
         ORDER BY t.id LIMIT 1`,
        [jsonList(teacherIds)]
    );
    return teacher;
}

async function deleteUsersBatch(actorUser, inputIds) {
    if (!Array.isArray(inputIds) || !inputIds.length) throw httpError('请选择要删除的用户');
    const normalizedIds = inputIds.map(value => Number(value));
    if (normalizedIds.some(id => !Number.isInteger(id) || id < 1)) throw httpError('批量删除的用户 ID 无效');
    const ids = [...new Set(normalizedIds)];
    if (ids.length > MAX_USER_BATCH_SIZE) throw httpError(`一次最多删除 ${MAX_USER_BATCH_SIZE} 个账号`);

    const actor = await getActorWithClass(actorUser);
    const targets = [];
    for (const chunk of userIdChunks(ids)) {
        const [rows] = await pool.query(
            'SELECT id, username, role, class_id FROM users WHERE id IN (?)',
            [chunk]
        );
        targets.push(...rows);
    }
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
    const blocked = await findOccupiedTeacher(teacherIds);
    if (blocked) throw httpError(`教师 ${blocked.username} 班级仍有学生，请先删除或转移班级学生`, 409);

    const statements = [];
    const dependentQueries = [
        'DELETE FROM user_permissions WHERE user_id IN (?)',
        'DELETE FROM user_competition_time_rules WHERE user_id IN (?)',
        'DELETE FROM user_access_policies WHERE user_id IN (?)',
        'DELETE FROM user_workflow_status WHERE user_id IN (?)',
        'DELETE FROM user_platform_account_status WHERE user_id IN (?)',
        'DELETE FROM user_competition_student_accounts WHERE user_id IN (?)',
        'DELETE FROM user_competition_expert_student_bindings WHERE user_id IN (?)',
        'DELETE FROM user_competition_expert_accounts WHERE user_id IN (?)',
        'DELETE FROM user_manual_teacher_credentials WHERE user_id IN (?)',
        'DELETE FROM user_class_removals WHERE user_id IN (?)',
        'DELETE FROM login_verification_codes WHERE user_id IN (?)',
        'DELETE FROM user_gifts WHERE target_user_id IN (?)',
        'UPDATE logo_library SET created_by = NULL WHERE created_by IN (?)',
        'UPDATE wallpaper_library SET created_by = NULL WHERE created_by IN (?)'
    ];
    const chunks = userIdChunks(ids);
    for (const sql of dependentQueries) {
        for (const chunk of chunks) statements.push([sql, [chunk]]);
    }
    for (const chunk of userIdChunks(teacherIds)) {
        statements.push(['DELETE FROM classes WHERE teacher_user_id IN (?)', [chunk]]);
    }
    for (const chunk of chunks) statements.push(['DELETE FROM users WHERE id IN (?)', [chunk]]);
    const giftsRevision = await deleteUsersAtomically(statements);
    return { ids, giftsRevision };
}

router.delete('/batch', authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const { ids, giftsRevision } = await deleteUsersBatch(req.user, req.body?.userIds || req.body?.ids);
        return res.json({ success: true, count: ids.length, userIds: ids, giftsRevision });
    } catch (err) {
        return res.status(err.status || 500).json({ error: err.message });
    }
});

// 删除用户
router.delete("/:id", authMiddleware, userManagerOnly, async (req, res) => {
    try {
        const target = await getManagedTarget(req.user, req.params.id);
        if (target.role === ROLES.TEACHER && await findOccupiedTeacher([target.id])) {
            throw httpError('该教师班级仍有学生，请先删除或转移班级学生', 409);
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
        const giftsRevision = await deleteUsersAtomically(statements);
        res.json({ success: true, giftsRevision });
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
            const [cards] = await pool.query('SELECT id FROM competitions WHERE id IN (SELECT value FROM json_each(?))', [jsonList(permissionIds)]);
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
                throw httpError(`竞赛 ${competitionId} 的时间格式无效`);
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
        const [[policy]] = await pool.query(
            'SELECT reset_session_revoke_mode AS revokeMode FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );
        const revokeMode = Object.hasOwn(RESET_REVOKE_DELAYS_MS, policy?.revokeMode) ? policy.revokeMode : 'immediate';
        const revokeBefore = new Date();
        const revokeAt = new Date(revokeBefore.getTime() + RESET_REVOKE_DELAYS_MS[revokeMode]);
        const resetPassword = ADMIN_RESET_DEFAULT_PASSWORD;
        const hashedPassword = await hashPassword(resetPassword);
        const changeDeadline = passwordChangeDeadline(revokeBefore.getTime());
        await pool.query(
            `UPDATE users
             SET password_hash = ?, session_revoke_before = ?, session_revoke_at = ?,
                 password_change_recommended = 1, password_change_deadline = ?
             WHERE id = ?`,
            [hashedPassword, revokeBefore, revokeAt, changeDeadline, req.params.id]
        );
        const changeNotice = `用户需在 ${PASSWORD_CHANGE_GRACE_DAYS} 天内修改密码，逾期后必须修改才能继续使用`;
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            success: true,
            message: revokeMode === 'immediate'
                ? `密码已重置为 123456，旧登录已立即撤销；${changeNotice}`
                : `密码已重置为 123456，旧登录将在 ${revokeMode === '1d' ? '1 天' : '7 天'}后撤销；${changeNotice}`,
            resetPassword,
            revokeMode,
            revokeAt: revokeAt.toISOString(),
            passwordChangeRecommended: true,
            passwordChangeDeadline: changeDeadline
        });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: "重置失败: " + err.message });
    }
});

export default router;
