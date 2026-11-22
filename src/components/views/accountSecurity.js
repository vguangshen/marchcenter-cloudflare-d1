// Shared rules for the account-security reminder (initial/reset password and
// missing email). The server enforces the same deadline in authMiddleware.
export const RESET_DEFAULT_PASSWORD = '123456';
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function passwordChangeDue(user, now = Date.now()) {
    if (!user?.passwordChangeRecommended) return null;
    const due = user.passwordChangeDeadline ? Date.parse(user.passwordChangeDeadline) : NaN;
    return Number.isFinite(due) ? due : now;
}

export function isPasswordChangeEnforced(user, now = Date.now()) {
    const due = passwordChangeDue(user, now);
    return due !== null && now >= due;
}

export function remainingDaysLabel(due, now = Date.now()) {
    const left = due - now;
    if (left <= 0) return '已到期';
    if (left < DAY_MS) return '今天内到期';
    return `剩余 ${Math.ceil(left / DAY_MS)} 天`;
}

export function validateNewPassword(password, confirm) {
    if (password.length < 6 || password.length > 128) return '新密码长度需为 6–128 位';
    if (password === RESET_DEFAULT_PASSWORD) return '新密码不能继续使用默认密码 123456';
    if (password !== confirm) return '两次输入的新密码不一致';
    return '';
}

export function validateEmail(email) {
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value) || value.length > 254) return '请输入有效的邮箱地址';
    return '';
}
