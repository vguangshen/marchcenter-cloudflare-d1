export const ROLES = Object.freeze({
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    TEACHER: 'teacher',
    STUDENT: 'student'
});

export const ROLE_RANK = Object.freeze({
    [ROLES.SUPER_ADMIN]: 3,
    [ROLES.ADMIN]: 2,
    [ROLES.TEACHER]: 1,
    [ROLES.STUDENT]: 0
});

export function normalizeRole(role) {
    if (role === 'user') return ROLES.STUDENT;
    return ROLE_RANK[role] !== undefined ? role : ROLES.STUDENT;
}

export function isSuperAdmin(user) {
    return normalizeRole(user?.role) === ROLES.SUPER_ADMIN;
}

export function canManageUsers(user) {
    return ROLE_RANK[normalizeRole(user?.role)] >= ROLE_RANK[ROLES.TEACHER];
}

export function canManageRole(actorRole, targetRole) {
    return ROLE_RANK[normalizeRole(actorRole)] > ROLE_RANK[normalizeRole(targetRole)];
}

export function canSeeUser(actor, target) {
    if (Number(actor?.id) === Number(target?.id)) return true;
    return canManageRole(actor?.role, target?.role);
}

export function assignableRoles(actorRole) {
    const role = normalizeRole(actorRole);
    if (role === ROLES.SUPER_ADMIN) return [ROLES.ADMIN, ROLES.TEACHER, ROLES.STUDENT];
    if (role === ROLES.ADMIN) return [ROLES.TEACHER, ROLES.STUDENT];
    if (role === ROLES.TEACHER) return [ROLES.STUDENT];
    return [];
}
