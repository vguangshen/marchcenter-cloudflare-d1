import pool from '../config/db.js';
import { normalizeRole, ROLES } from './roleAccess.js';

export async function getUserAccess(userId) {
    const [[policyRows], [permissionRows], [timeRows]] = await Promise.all([
        pool.query('SELECT configured FROM user_access_policies WHERE user_id = ?', [userId]),
        pool.query('SELECT competition_id FROM user_permissions WHERE user_id = ?', [userId]),
        pool.query('SELECT competition_id, unlock_time, lock_time FROM user_competition_time_rules WHERE user_id = ?', [userId])
    ]);
    const timeRules = Object.fromEntries(timeRows.map(row => [String(row.competition_id), {
        unlockTime: row.unlock_time,
        lockTime: row.lock_time
    }]));
    return {
        configured: Boolean(policyRows[0]?.configured),
        permissions: permissionRows.map(row => Number(row.competition_id)),
        timeRules
    };
}

export async function getUsersAccess(userIds = []) {
    const ids = [...new Set(userIds.map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return new Map();
    const [[policies], [permissions], [timeRules]] = await Promise.all([
        pool.query('SELECT user_id, configured FROM user_access_policies WHERE user_id IN (?)', [ids]),
        pool.query('SELECT user_id, competition_id FROM user_permissions WHERE user_id IN (?)', [ids]),
        pool.query('SELECT user_id, competition_id, unlock_time, lock_time FROM user_competition_time_rules WHERE user_id IN (?)', [ids])
    ]);
    const output = new Map(ids.map(id => [id, { configured: false, permissions: [], timeRules: {} }]));
    for (const row of policies) output.get(Number(row.user_id)).configured = Boolean(row.configured);
    for (const row of permissions) output.get(Number(row.user_id)).permissions.push(Number(row.competition_id));
    for (const row of timeRules) output.get(Number(row.user_id)).timeRules[String(row.competition_id)] = {
        unlockTime: row.unlock_time,
        lockTime: row.lock_time
    };
    return output;
}

export function isTimeRuleActive(rule, now = new Date()) {
    if (!rule) return true;
    const unlockTime = rule.unlockTime ? new Date(rule.unlockTime) : null;
    const lockTime = rule.lockTime ? new Date(rule.lockTime) : null;
    if (unlockTime && !Number.isNaN(unlockTime.getTime()) && now < unlockTime) return false;
    if (lockTime && !Number.isNaN(lockTime.getTime()) && now > lockTime) return false;
    return true;
}

export async function assertCompetitionAccess(user, competitionId) {
    const [[competition]] = await pool.query(
        'SELECT id, unlock_time AS unlockTime, lock_time AS lockTime FROM competitions WHERE id = ? LIMIT 1',
        [competitionId]
    );
    if (!competition) {
        const error = new Error('竞赛不存在');
        error.status = 404;
        throw error;
    }
    const role = normalizeRole(user?.role);
    if (role !== ROLES.SUPER_ADMIN && !isTimeRuleActive(competition)) {
        const error = new Error('该竞赛当前不在允许访问时间内');
        error.status = 403;
        throw error;
    }
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role)) return;
    const access = await getUserAccess(user.id);
    if (!access.configured) {
        const error = new Error('账号尚未配置竞赛访问权限');
        error.status = 403;
        throw error;
    }
    const numericId = Number(competitionId);
    if (!access.permissions.includes(numericId)) {
        const error = new Error('您没有访问该竞赛的权限');
        error.status = 403;
        throw error;
    }
    if (!isTimeRuleActive(access.timeRules[String(numericId)])) {
        const error = new Error('该竞赛当前不在允许访问时间内');
        error.status = 403;
        throw error;
    }
}

export async function filterCompetitionsForUser(user, competitions) {
    if (!user) return [];
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(normalizeRole(user.role))) return competitions;
    const access = await getUserAccess(user.id);
    if (!access.configured) return [];
    return competitions.filter(item => {
        const id = Number(item.id);
        return access.permissions.includes(id);
    }).map(item => ({ ...item, _overrideTime: access.timeRules[String(item.id)] || null }));
}
