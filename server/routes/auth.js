import express from '../compat/express.js';
import pool from "../config/db.js";
import { authMiddleware, getJwtSecret } from "../middleware/auth.js";
import { normalizeRole, ROLES } from "../utils/roleAccess.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/token.js";
import {
    emailServiceState, readEmailSettings, sendPasswordResetCodeEmail,
    sendRegistrationCodeEmail, sendVerificationCodeEmail
} from '../services/emailService.js';
import {
    normalizeRegistrationInput, registrationCodeSubject, registrationValidationError
} from '../utils/registration.js';
import { extractGeoFromRequest } from '../utils/geolocation.js';
import { getEnv } from '../config/runtime.js';
import { withD1Lock } from '../utils/d1Lock.js';

const router = express.Router();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const CODE_MAX_ATTEMPTS = 5;
const REGISTRATION_EMAIL_MAX_PER_WINDOW = 5;
const LOGIN_EMAIL_MAX_PER_WINDOW = 8;
const PASSWORD_RESET_EMAIL_MAX_PER_WINDOW = 5;
const GENERIC_EMAIL_RESPONSE = Object.freeze({
    message: '如果该邮箱对应可用账号，我们会发送验证码',
    accepted: true
});

async function bootstrapSecretMatches(value) {
    const configured = String(getEnv('INITIAL_ADMIN_BOOTSTRAP_SECRET', ''));
    const provided = String(value || '');
    if (!configured || !provided) return false;
    const [expected, actual] = await Promise.all([
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(configured)),
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(provided))
    ]);
    const left = new Uint8Array(expected);
    const right = new Uint8Array(actual);
    let difference = left.length ^ right.length;
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

function createVerificationCode() {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return String(values[0] % 1_000_000).padStart(6, '0');
}

async function verificationCodeHash(subject, code, purpose = 'login') {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(getJwtSecret()),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const digest = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`${purpose}:${subject}:${code}`)
    );
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function completeLogin(req, res, user) {
    const payload = {
        id: user.id,
        username: user.username,
        role: normalizeRole(user.role),
        passwordChangeRecommended: Boolean(user.password_change_recommended)
    };
    const token = await signToken(payload, getJwtSecret());
    // 登录成功即按 request.cf 记录来源地理位置（IP 推断，城市级）；历史入库，
    // 最新位置回写 users 供用户列表展示。cf 缺失时字段为 null，不影响登录。
    const geo = extractGeoFromRequest(req);
    await pool.query(
        `UPDATE users SET last_login_at = NOW(), last_ip = ?,
         last_latitude = ?, last_longitude = ?,
         last_city = ?, last_country_code = ?, last_region = ?, last_timezone = ?, last_organization = ?
         WHERE id = ?`,
        [geo.ip, geo.latitude, geo.longitude, geo.city, geo.countryCode, geo.region, geo.timezone, geo.organization, user.id]
    );
    try {
        await pool.query(
            `INSERT INTO user_login_locations
             (user_id, latitude, longitude, city, country_code, region, timezone, organization, ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, geo.latitude, geo.longitude, geo.city, geo.countryCode, geo.region, geo.timezone, geo.organization, geo.ip]
        );
    } catch (error) {
        // 历史记录是尽力而为，写入失败不影响登录。
        console.warn('记录登录位置失败:', error.message);
    }
    res.json({ token, user: payload });
}

async function attemptKey(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function clientIp(req) {
    return String(req.ip || '').trim();
}

async function loginAttemptKey(req, username) {
    return attemptKey(`${clientIp(req)}:${String(username || '').trim().toLowerCase()}`);
}

async function registrationEmailAttemptKey(req) {
    return attemptKey(`${clientIp(req)}:registration-email`);
}

async function loginEmailAttemptKey(req) {
    return attemptKey(`${clientIp(req)}:login-email`);
}

async function passwordResetEmailAttemptKey(req) {
    return attemptKey(`${clientIp(req)}:password-reset-email`);
}

async function currentLoginAttempts(attemptKey, now) {
    const [rows] = await pool.query(
        'SELECT attempt_count AS count, expires_at AS expiresAt FROM login_attempts WHERE attempt_key = ?',
        [attemptKey]
    );
    if (!rows.length || Number(rows[0].expiresAt) <= now) return 0;
    return Number(rows[0].count) || 0;
}

async function recordFailedLogin(attemptKey, now) {
    const expiresAt = now + LOGIN_WINDOW_MS;
    await pool.query(
        `INSERT INTO login_attempts (attempt_key, attempt_count, window_started_at, expires_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(attempt_key) DO UPDATE SET
           attempt_count = CASE WHEN login_attempts.expires_at <= excluded.window_started_at
                                THEN 1 ELSE login_attempts.attempt_count + 1 END,
           window_started_at = CASE WHEN login_attempts.expires_at <= excluded.window_started_at
                                    THEN excluded.window_started_at ELSE login_attempts.window_started_at END,
           expires_at = CASE WHEN login_attempts.expires_at <= excluded.window_started_at
                             THEN excluded.expires_at ELSE login_attempts.expires_at END`,
        [attemptKey, now, expiresAt]
    );
}

router.post('/register/verification-code/request', async (req, res) => {
    const input = normalizeRegistrationInput(req.body);
    const validationError = registrationValidationError(input, { requirePassword: false, requireCode: false });
    if (validationError) return res.status(400).json({ error: validationError });

    const emailConfig = await readEmailSettings();
    if (!emailServiceState(emailConfig).ready) {
        return res.status(503).json({ error: '注册邮件服务尚未启用，请联系管理员' });
    }

    try {
        const sendAttemptKey = await registrationEmailAttemptKey(req);
        const now = Date.now();
        if (await currentLoginAttempts(sendAttemptKey, now) >= REGISTRATION_EMAIL_MAX_PER_WINDOW) {
            return res.status(429).json({ error: '注册验证码发送过于频繁，请稍后再试' });
        }
        const [existingUsers] = await pool.query(
            `SELECT id FROM users
             WHERE lower(username) = lower(?) OR lower(email) = lower(?)
             LIMIT 1`,
            [input.username, input.email]
        );
        if (existingUsers.length) {
            await recordFailedLogin(sendAttemptKey, now);
            return res.json({
                ...GENERIC_EMAIL_RESPONSE,
                expiresIn: emailConfig.codeTtlMinutes * 60,
                retryAfter: emailConfig.resendSeconds
            });
        }

        const resendMs = emailConfig.resendSeconds * 1000;
        const ttlMs = emailConfig.codeTtlMinutes * 60 * 1000;
        await pool.query('DELETE FROM registration_verification_codes WHERE expires_at <= ?', [now]);
        const [existingCodes] = await pool.query(
            `SELECT requested_at AS requestedAt
             FROM registration_verification_codes
             WHERE lower(email) = lower(?)`,
            [input.email]
        );
        const requestedAt = Number(existingCodes[0]?.requestedAt || 0);
        if (requestedAt && now - requestedAt < resendMs) {
            const retryAfter = Math.ceil((resendMs - (now - requestedAt)) / 1000);
            return res.json({ ...GENERIC_EMAIL_RESPONSE, expiresIn: ttlMs / 1000, retryAfter });
        }

        const code = createVerificationCode();
        const codeHash = await verificationCodeHash(
            registrationCodeSubject(input.username, input.email),
            code,
            'register'
        );
        const expiresAt = now + ttlMs;
        await pool.query(
            `INSERT INTO registration_verification_codes
                (email, username, code_hash, requested_at, expires_at, attempt_count, consumed_at)
             VALUES (?, ?, ?, ?, ?, 0, NULL)
             ON CONFLICT(email) DO UPDATE SET
                username = excluded.username,
                code_hash = excluded.code_hash,
                requested_at = excluded.requested_at,
                expires_at = excluded.expires_at,
                attempt_count = 0,
                consumed_at = NULL`,
            [input.email, input.username, codeHash, now, expiresAt]
        );
        await recordFailedLogin(sendAttemptKey, now);

        try {
            await sendRegistrationCodeEmail({
                settings: emailConfig,
                to: input.email,
                username: input.username,
                code
            });
        } catch (error) {
            await pool.query(
                `DELETE FROM registration_verification_codes
                 WHERE lower(email) = lower(?) AND requested_at = ?`,
                [input.email, now]
            );
            console.error('Registration verification email failed:', error);
            return res.status(502).json({ error: '注册验证码发送失败，请稍后重试' });
        }

        return res.json({
            ...GENERIC_EMAIL_RESPONSE,
            expiresIn: ttlMs / 1000,
            retryAfter: resendMs / 1000
        });
    } catch (error) {
        console.error('Registration verification request failed:', error);
        return res.status(500).json({ error: '注册验证码请求失败，请稍后重试' });
    }
});

// 空数据库仍可创建首个超级管理员；初始化后通过邮箱验证自助注册无竞赛权限的教师账号。
router.post("/register", async (req, res) => {
    const input = normalizeRegistrationInput(req.body);

    try {
        const [countRows] = await pool.query("SELECT COUNT(*) AS count FROM users");
        const initialized = Number(countRows[0]?.count) !== 0;
        const validationError = registrationValidationError(input, { requireCode: initialized });
        if (validationError) return res.status(400).json({ error: validationError });

        if (initialized) {
            const emailConfig = await readEmailSettings();
            if (!emailServiceState(emailConfig).ready) {
                return res.status(503).json({ error: '注册邮件服务尚未启用，请联系管理员' });
            }
        }

        const [existingUsers] = await pool.query(
            `SELECT id FROM users
             WHERE lower(username) = lower(?) OR lower(email) = lower(?)
             LIMIT 1`,
            [input.username, input.email]
        );
        if (existingUsers.length) return res.status(409).json({ error: "用户名或邮箱已被注册" });

        if (!initialized) {
            if (!await bootstrapSecretMatches(req.body?.bootstrapSecret)) {
                return res.status(403).json({
                    error: getEnv('INITIAL_ADMIN_BOOTSTRAP_SECRET', '')
                        ? '系统初始化密钥无效'
                        : '系统尚未配置初始化密钥，请部署管理员先设置 Worker Secret',
                    code: 'bootstrap_authorization_required'
                });
            }
            const created = await withD1Lock('mc-system-bootstrap', async () => {
                const [[currentCount]] = await pool.query('SELECT COUNT(*) AS count FROM users');
                if (Number(currentCount?.count) !== 0) {
                    const error = new Error('系统已经完成初始化，请按普通注册流程操作');
                    error.status = 409;
                    throw error;
                }
                const hash = await hashPassword(input.password);
                const [result] = await pool.query(
                    "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, NOW())",
                    [input.username, input.email, hash, ROLES.SUPER_ADMIN]
                );
                await pool.query(
                    `INSERT INTO system_initialization (singleton_id, initialized_by_user_id)
                     VALUES (1, ?)`,
                    [result.insertId]
                );
                return result;
            }, { waitMs: 2000, leaseMs: 15000 });
            return res.status(201).json({ id: created.insertId, username: input.username, email: input.email, role: ROLES.SUPER_ADMIN });
        }

        const [codeRows] = await pool.query(
            `SELECT username, code_hash AS codeHash, expires_at AS expiresAt,
                    attempt_count AS attemptCount, consumed_at AS consumedAt
             FROM registration_verification_codes
             WHERE lower(email) = lower(?)`,
            [input.email]
        );
        const record = codeRows[0];
        const now = Date.now();
        if (!record || record.consumedAt || Number(record.expiresAt) <= now || Number(record.attemptCount) >= CODE_MAX_ATTEMPTS) {
            return res.status(400).json({ error: '注册验证码无效或已过期' });
        }
        if (String(record.username).toLowerCase() !== input.username.toLowerCase()) {
            return res.status(400).json({ error: '用户名已变更，请重新获取验证码' });
        }

        const incomingHash = await verificationCodeHash(
            registrationCodeSubject(input.username, input.email),
            input.code,
            'register'
        );
        if (incomingHash !== record.codeHash) {
            await pool.query(
                `UPDATE registration_verification_codes
                 SET attempt_count = attempt_count + 1
                 WHERE lower(email) = lower(?)`,
                [input.email]
            );
            return res.status(400).json({ error: '邮箱验证码错误' });
        }

        const passwordHash = await hashPassword(input.password);
        const results = await pool.batch([
            [
                `INSERT INTO users (username, email, password_hash, role, created_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [input.username, input.email, passwordHash, ROLES.TEACHER]
            ],
            [
                `INSERT INTO classes (name, teacher_user_id, created_by)
                 SELECT username || ' 的班级', id, id FROM users WHERE username = ?`,
                [input.username]
            ],
            [
                `UPDATE users SET class_id = (
                    SELECT id FROM classes WHERE teacher_user_id = users.id
                 ) WHERE username = ?`,
                [input.username]
            ],
            [
                `INSERT INTO user_access_policies (user_id, configured, updated_at)
                 SELECT id, 1, CURRENT_TIMESTAMP FROM users WHERE username = ?`,
                [input.username]
            ],
            [
                `UPDATE registration_verification_codes
                 SET consumed_at = ?
                 WHERE lower(email) = lower(?) AND consumed_at IS NULL`,
                [now, input.email]
            ]
        ]);
        const createdId = results[0]?.insertId;
        return res.status(201).json({
            id: createdId,
            username: input.username,
            email: input.email,
            role: ROLES.TEACHER,
            permissions: []
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: '用户名、邮箱或班级名称已被使用' });
        }
        console.error('Registration failed:', err);
        const status = Number(err.status) || 500;
        return res.status(status).json({
            error: status >= 500 ? '注册失败，请稍后重试' : (err.message || '注册失败')
        });
    }
});

router.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || password.length > 256) {
        return res.status(400).json({ error: '用户名或密码错误' });
    }
    const attemptKey = await loginAttemptKey(req, username);
    const now = Date.now();
    if (await currentLoginAttempts(attemptKey, now) >= LOGIN_MAX_ATTEMPTS) {
        return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
    }
    try {
        const [rows] = await pool.query(
            `SELECT * FROM users
             WHERE lower(username) = lower(?) OR lower(email) = lower(?)
             LIMIT 1`,
            [username.trim(), username.trim()]
        );
        if (rows.length === 0) {
            await recordFailedLogin(attemptKey, now);
            return res.status(400).json({ error: '用户名或密码错误' });
        }

        const user = rows[0];
        if (user.is_disabled) {
            return res.status(403).json({ error: "账号已被禁用，请联系管理员" });
        }
        if (!(await verifyPassword(password, user.password_hash))) {
            await recordFailedLogin(attemptKey, now);
            return res.status(400).json({ error: '用户名或密码错误' });
        }
        await pool.query('DELETE FROM login_attempts WHERE attempt_key = ?', [attemptKey]);
        await completeLogin(req, res, user);
    } catch (err) {
        res.status(500).json({ error: "登录异常" });
    }
});

router.post('/verification-code/request', async (req, res) => {
    const email = String(req.body?.account || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ error: '请输入已绑定账号的有效邮箱' });
    }

    const emailConfig = await readEmailSettings();
    if (!emailServiceState(emailConfig).ready) {
        return res.status(503).json({ error: '验证码登录尚未完成邮件服务配置' });
    }

    try {
        const now = Date.now();
        const sendAttemptKey = await loginEmailAttemptKey(req);
        if (await currentLoginAttempts(sendAttemptKey, now) >= LOGIN_EMAIL_MAX_PER_WINDOW) {
            return res.status(429).json({ error: '验证码请求过于频繁，请稍后再试' });
        }
        await recordFailedLogin(sendAttemptKey, now);

        const codeTtlMs = emailConfig.codeTtlMinutes * 60 * 1000;
        const codeResendMs = emailConfig.resendSeconds * 1000;
        const [rows] = await pool.query(
            `SELECT id, username, email, is_disabled
             FROM users
             WHERE lower(email) = lower(?)
             LIMIT 1`,
            [email]
        );
        const user = rows[0];
        if (!user || user.is_disabled || !user.email) {
            await verificationCodeHash(email, createVerificationCode(), 'login-enumeration-padding');
            return res.json({
                ...GENERIC_EMAIL_RESPONSE,
                expiresIn: codeTtlMs / 1000,
                retryAfter: codeResendMs / 1000
            });
        }

        const [existingRows] = await pool.query(
            `SELECT requested_at AS requestedAt
             FROM login_verification_codes
             WHERE user_id = ? AND purpose = 'login'`,
            [user.id]
        );
        const requestedAt = Number(existingRows[0]?.requestedAt || 0);
        if (requestedAt && now - requestedAt < codeResendMs) {
            const retryAfter = Math.ceil((codeResendMs - (now - requestedAt)) / 1000);
            return res.json({ ...GENERIC_EMAIL_RESPONSE, expiresIn: codeTtlMs / 1000, retryAfter });
        }

        const code = createVerificationCode();
        const codeHash = await verificationCodeHash(user.id, code);
        const expiresAt = now + codeTtlMs;
        await pool.query(
            `INSERT INTO login_verification_codes
                (user_id, purpose, code_hash, requested_at, expires_at, attempt_count, consumed_at)
             VALUES (?, 'login', ?, ?, ?, 0, NULL)
             ON CONFLICT(user_id, purpose) DO UPDATE SET
                code_hash = excluded.code_hash,
                requested_at = excluded.requested_at,
                expires_at = excluded.expires_at,
                attempt_count = 0,
                consumed_at = NULL`,
            [user.id, codeHash, now, expiresAt]
        );

        try {
            await sendVerificationCodeEmail({
                settings: emailConfig,
                to: user.email,
                username: user.username,
                code
            });
        } catch (error) {
            await pool.query(
                `DELETE FROM login_verification_codes WHERE user_id = ? AND purpose = 'login'`,
                [user.id]
            );
            console.error('Verification email send failed:', error);
            return res.status(502).json({ error: '验证码发送失败，请稍后重试' });
        }

        res.json({
            ...GENERIC_EMAIL_RESPONSE,
            expiresIn: codeTtlMs / 1000,
            retryAfter: codeResendMs / 1000
        });
    } catch (error) {
        console.error('Verification code request failed:', error);
        res.status(500).json({ error: '验证码请求失败，请稍后重试' });
    }
});

router.post('/verification-code/login', async (req, res) => {
    const email = String(req.body?.account || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '请输入有效邮箱和 6 位验证码' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT id, username, email, role, is_disabled,
                    password_change_recommended
             FROM users
             WHERE lower(email) = lower(?)
             LIMIT 1`,
            [email]
        );
        const user = rows[0];
        if (!user || user.is_disabled) {
            return res.status(400).json({ error: '邮箱或验证码错误' });
        }
        const [codeRows] = await pool.query(
            `SELECT code_hash AS codeHash, expires_at AS expiresAt,
                    attempt_count AS attemptCount, consumed_at AS consumedAt
             FROM login_verification_codes
             WHERE user_id = ? AND purpose = 'login'`,
            [user.id]
        );
        const record = codeRows[0];
        const now = Date.now();
        if (!record || record.consumedAt || Number(record.expiresAt) <= now || Number(record.attemptCount) >= CODE_MAX_ATTEMPTS) {
            return res.status(400).json({ error: '验证码无效或已过期' });
        }

        const incomingHash = await verificationCodeHash(user.id, code);
        if (incomingHash !== record.codeHash) {
            await pool.query(
                `UPDATE login_verification_codes
                 SET attempt_count = attempt_count + 1
                 WHERE user_id = ? AND purpose = 'login'`,
                [user.id]
            );
            return res.status(400).json({ error: '邮箱或验证码错误' });
        }

        const [consumeResult] = await pool.query(
            `UPDATE login_verification_codes
             SET consumed_at = ?
             WHERE user_id = ? AND purpose = 'login' AND consumed_at IS NULL`,
            [now, user.id]
        );
        if (!consumeResult.affectedRows) {
            return res.status(400).json({ error: '验证码已被使用' });
        }
        await completeLogin(req, res, user);
    } catch (error) {
        console.error('Verification code login failed:', error);
        res.status(500).json({ error: '验证码登录异常' });
    }
});

router.post('/password-reset/verification-code/request', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ error: '请输入账号绑定的有效邮箱' });
    }

    const emailConfig = await readEmailSettings();
    if (!emailServiceState(emailConfig).ready) {
        return res.status(503).json({ error: '密码重置邮件服务尚未启用，请联系管理员' });
    }

    try {
        const now = Date.now();
        const sendAttemptKey = await passwordResetEmailAttemptKey(req);
        if (await currentLoginAttempts(sendAttemptKey, now) >= PASSWORD_RESET_EMAIL_MAX_PER_WINDOW) {
            return res.status(429).json({ error: '密码重置验证码发送过于频繁，请稍后再试' });
        }
        await recordFailedLogin(sendAttemptKey, now);

        const [rows] = await pool.query(
            `SELECT id, username, email, is_disabled
             FROM users
             WHERE lower(email) = lower(?)
             LIMIT 1`,
            [email]
        );
        const user = rows[0];
        if (!user || user.is_disabled || !user.email) {
            await verificationCodeHash(email, createVerificationCode(), 'password-reset-enumeration-padding');
            return res.json({
                ...GENERIC_EMAIL_RESPONSE,
                expiresIn: emailConfig.codeTtlMinutes * 60,
                retryAfter: emailConfig.resendSeconds
            });
        }

        const resendMs = emailConfig.resendSeconds * 1000;
        const ttlMs = emailConfig.codeTtlMinutes * 60 * 1000;
        const [existingRows] = await pool.query(
            `SELECT requested_at AS requestedAt
             FROM login_verification_codes
             WHERE user_id = ? AND purpose = 'password_reset'`,
            [user.id]
        );
        const requestedAt = Number(existingRows[0]?.requestedAt || 0);
        if (requestedAt && now - requestedAt < resendMs) {
            const retryAfter = Math.ceil((resendMs - (now - requestedAt)) / 1000);
            return res.json({ ...GENERIC_EMAIL_RESPONSE, expiresIn: ttlMs / 1000, retryAfter });
        }

        const code = createVerificationCode();
        const codeHash = await verificationCodeHash(user.id, code, 'password_reset');
        const expiresAt = now + ttlMs;
        await pool.query(
            `INSERT INTO login_verification_codes
                (user_id, purpose, code_hash, requested_at, expires_at, attempt_count, consumed_at)
             VALUES (?, 'password_reset', ?, ?, ?, 0, NULL)
             ON CONFLICT(user_id, purpose) DO UPDATE SET
                code_hash = excluded.code_hash,
                requested_at = excluded.requested_at,
                expires_at = excluded.expires_at,
                attempt_count = 0,
                consumed_at = NULL`,
            [user.id, codeHash, now, expiresAt]
        );

        try {
            await sendPasswordResetCodeEmail({
                settings: emailConfig,
                to: user.email,
                username: user.username,
                code
            });
        } catch (error) {
            await pool.query(
                `DELETE FROM login_verification_codes
                 WHERE user_id = ? AND purpose = 'password_reset'`,
                [user.id]
            );
            console.error('Password reset email send failed:', error);
            return res.status(502).json({ error: '密码重置验证码发送失败，请稍后重试' });
        }

        return res.json({
            ...GENERIC_EMAIL_RESPONSE,
            expiresIn: ttlMs / 1000,
            retryAfter: resendMs / 1000
        });
    } catch (error) {
        console.error('Password reset verification request failed:', error);
        return res.status(500).json({ error: '密码重置验证码请求失败，请稍后重试' });
    }
});

router.post('/password-reset/confirm', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ error: '请输入账号绑定的有效邮箱' });
    }
    if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: '请输入 6 位邮箱验证码' });
    }
    if (password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: '新密码长度需为 6–128 位' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT id, username, is_disabled
             FROM users
             WHERE lower(email) = lower(?)
             LIMIT 1`,
            [email]
        );
        const user = rows[0];
        if (!user || user.is_disabled) {
            return res.status(400).json({ error: '邮箱或验证码错误' });
        }

        const [codeRows] = await pool.query(
            `SELECT code_hash AS codeHash, expires_at AS expiresAt,
                    attempt_count AS attemptCount, consumed_at AS consumedAt
             FROM login_verification_codes
             WHERE user_id = ? AND purpose = 'password_reset'`,
            [user.id]
        );
        const record = codeRows[0];
        const now = Date.now();
        if (!record || record.consumedAt || Number(record.expiresAt) <= now || Number(record.attemptCount) >= CODE_MAX_ATTEMPTS) {
            return res.status(400).json({ error: '密码重置验证码无效或已过期' });
        }

        const incomingHash = await verificationCodeHash(user.id, code, 'password_reset');
        if (incomingHash !== record.codeHash) {
            await pool.query(
                `UPDATE login_verification_codes
                 SET attempt_count = attempt_count + 1
                 WHERE user_id = ? AND purpose = 'password_reset'`,
                [user.id]
            );
            return res.status(400).json({ error: '邮箱或验证码错误' });
        }

        const passwordHash = await hashPassword(password);
        const [consumeResult] = await pool.query(
            `UPDATE login_verification_codes
             SET consumed_at = ?
             WHERE user_id = ? AND purpose = 'password_reset' AND consumed_at IS NULL`,
            [now, user.id]
        );
        if (!consumeResult.affectedRows) {
            return res.status(400).json({ error: '验证码已被使用' });
        }
        await pool.batch([
            [`UPDATE users
              SET password_hash = ?, password_change_recommended = 0,
                  session_revoke_before = CURRENT_TIMESTAMP,
                  session_revoke_at = CURRENT_TIMESTAMP
              WHERE id = ?`, [passwordHash, user.id]],
            [`DELETE FROM login_verification_codes WHERE user_id = ? AND purpose = 'login'`, [user.id]]
        ]);
        return res.json({ message: '密码重置成功，请使用新密码登录' });
    } catch (error) {
        console.error('Password reset failed:', error);
        return res.status(500).json({ error: '密码重置失败，请稍后重试' });
    }
});

router.get('/setup-status', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT COUNT(*) AS count FROM users');
        const emailReady = emailServiceState(await readEmailSettings()).ready;
        res.json({
            initialized: Number(rows[0]?.count || 0) > 0,
            bootstrapSecretConfigured: Boolean(getEnv('INITIAL_ADMIN_BOOTSTRAP_SECRET', '')),
            verificationCodeEnabled: emailReady,
            registrationEnabled: emailReady,
            passwordResetEnabled: emailReady
        });
    } catch {
        res.status(503).json({ error: '系统状态暂时不可用' });
    }
});

router.post('/change-password', authMiddleware, async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!req.user.passwordChangeRecommended) {
        return res.status(409).json({ error: '当前账号没有待处理的改密提醒' });
    }
    if (password.length < 6 || password.length > 128) {
        return res.status(400).json({ error: '新密码长度需为 6–128 位' });
    }
    try {
        const passwordHash = await hashPassword(password);
        await pool.query(
            `UPDATE users
             SET password_hash = ?, password_change_recommended = 0
             WHERE id = ? AND password_change_recommended = 1`,
            [passwordHash, req.user.id]
        );
        return res.json({ success: true, message: '新密码已生效' });
    } catch (error) {
        console.error('Recommended password change failed:', error);
        return res.status(500).json({ error: '修改密码失败，请稍后重试' });
    }
});

router.get('/me', authMiddleware, (req, res) => res.json({ user: req.user }));

export default router;
