import pool from '../config/db.js';
import { normalizeRole, ROLES } from './roleAccess.js';

export function canSeeUserInClass(actor, target) {
    if (normalizeRole(actor?.role) !== ROLES.TEACHER) return true;
    if (Number(actor?.id) === Number(target?.id)) return true;
    return normalizeRole(target?.role) === ROLES.STUDENT &&
        actor?.class_id != null && Number(actor.class_id) === Number(target.class_id);
}

export async function getActorWithClass(actor) {
    const [rows] = await pool.query('SELECT id, username, role, class_id FROM users WHERE id = ? LIMIT 1', [actor.id]);
    return rows[0] ? { ...rows[0], role: normalizeRole(rows[0].role) } : null;
}
