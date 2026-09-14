const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRegistrationInput(value = {}) {
    return {
        username: String(value.username || '').trim(),
        email: String(value.email || '').trim().toLowerCase(),
        password: typeof value.password === 'string' ? value.password : '',
        code: String(value.code || '').trim()
    };
}

export function registrationValidationError(input, { requirePassword = true, requireCode = true } = {}) {
    if (input.username.length < 2 || input.username.length > 64 || /[\u0000-\u001f\u007f]/.test(input.username)) {
        return '用户名长度需为 2–64 位，且不能包含控制字符';
    }
    if (!EMAIL_PATTERN.test(input.email) || input.email.length > 254) {
        return '请输入有效的电子邮箱';
    }
    if (requirePassword && (input.password.length < 6 || input.password.length > 128)) {
        return '密码长度需为 6–128 位';
    }
    if (requireCode && !/^\d{6}$/.test(input.code)) {
        return '请输入有效的 6 位邮箱验证码';
    }
    return '';
}

export function registrationCodeSubject(username, email) {
    return `${email}\n${username.toLowerCase()}`;
}
