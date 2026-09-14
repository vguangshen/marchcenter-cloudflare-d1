import express from '../compat/express.js';
import pool from "../config/db.js";
import { authMiddleware, adminOnly } from "../middleware/auth.js";
import { assertCompetitionAccess, filterCompetitionsForUser } from "../utils/accessControl.js";
import { decodeStoredConfig, decryptSecretValue, encryptSecretValue } from '../utils/configSecrets.js';
import { isSuperAdmin } from '../utils/roleAccess.js';
import { validateOfficialCardAddress } from '../utils/officialCompat/cardAddress.js';
import { isClassDeleteMappingReady, normalizeClassDeleteMapping } from '../utils/accountManagementApi.js';

const router = express.Router();

function classDeleteSelection(data) {
    const mapping = normalizeClassDeleteMapping(data.classDeleteMapping);
    if (mapping.enabled && !isClassDeleteMappingReady(mapping)) {
        throw Object.assign(new Error('请完整配置班级与关联账号删除映射'), { status: 400 });
    }
    const hasContent = mapping.apiId || mapping.databaseName || mapping.classTable || mapping.classNameColumn;
    return hasContent ? JSON.stringify(mapping) : null;
}

function competitionTimes(data) {
    const unlockTime = data.unlockTime ? new Date(data.unlockTime) : null;
    const lockTime = data.lockTime ? new Date(data.lockTime) : null;
    if ((unlockTime && Number.isNaN(unlockTime.getTime())) || (lockTime && Number.isNaN(lockTime.getTime()))) {
        const error = new Error('开放时间格式无效');
        error.status = 400;
        throw error;
    }
    if (unlockTime && lockTime && unlockTime >= lockTime) {
        const error = new Error('结束时间必须晚于开始时间');
        error.status = 400;
        throw error;
    }
    return { unlockTime, lockTime };
}

function accountDatabaseSelection(data) {
    const enabled = data.manualCredentialEnabled === true
        || data.manualCredentialEnabled === 1
        || data.manualCredentialEnabled === '1'
        || data.manualCredentialEnabled === 'true';
    const apiId = String(data.accountApiId || '').trim();
    if (apiId.length > 80 || (apiId && !/^[A-Za-z0-9_-]+$/.test(apiId))) {
        const error = new Error('账号管理 API 编号无效');
        error.status = 400;
        throw error;
    }
    const provider = ['sqlserver', 'mysql'].includes(String(data.accountDbProvider || '').toLowerCase())
        ? String(data.accountDbProvider).toLowerCase() : null;
    const name = String(data.accountDbName || '').trim();
    const table = String(data.accountTableName || '').trim();
    const usernameColumn = String(data.accountUsernameColumn || '').trim();
    const passwordColumn = String(data.accountPasswordColumn || '').trim();
    const passwordAlgorithm = String(data.accountPasswordAlgorithm || '').trim().toLowerCase();
    const allowedPasswordAlgorithms = new Set([
        'itmc-java-long-md5', 'itmc-des', 'itmc-sandbox-des', 'plain',
        'md5-lower', 'md5-upper', 'double-md5-lower', 'sha1-lower', 'sha1-upper',
        'sha256-lower', 'sha256-upper'
    ]);
    if (passwordAlgorithm && !allowedPasswordAlgorithms.has(passwordAlgorithm)) {
        const error = new Error('密码加密算法无效');
        error.status = 400;
        throw error;
    }
    if (name.length > 128 || [...name].some(char => char.charCodeAt(0) < 32)) {
        const error = new Error('数据库名称无效');
        error.status = 400;
        throw error;
    }
    if (table && !/^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/.test(table)) {
        const error = new Error('数据表名称无效');
        error.status = 400;
        throw error;
    }
    const validIdentifier = value => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value);
    if ((usernameColumn && !validIdentifier(usernameColumn)) || (passwordColumn && !validIdentifier(passwordColumn))) {
        const error = new Error('账号字段名称无效');
        error.status = 400;
        throw error;
    }
    if (enabled && (!apiId || !provider || !name || !table || !usernameColumn || !passwordColumn || !passwordAlgorithm)) {
        const error = new Error('请选择完整的 API、数据库、数据表、账号字段、密码字段和密码算法');
        error.status = 400;
        throw error;
    }
    const expectedProvider = data.ssoMethod === 'java' ? 'mysql'
        : ['net', 'marketing', 'commerce', 'managementAccounting',
            'crossBorderCommerce', 'enterpriseManagement'].includes(data.ssoMethod) ? 'sqlserver' : null;
    if (provider && expectedProvider && provider !== expectedProvider) {
        const error = new Error(data.ssoMethod === 'java' ? 'JAVA 接入方式应选择 MySQL' : '该接入方式应选择 SQL Server');
        error.status = 400;
        throw error;
    }
    return {
        manualCredentialEnabled: enabled ? 1 : 0,
        apiId: apiId || null,
        provider,
        name: name || null,
        table: table || null,
        usernameColumn: usernameColumn || null,
        passwordColumn: passwordColumn || null,
        passwordAlgorithm: passwordAlgorithm || null,
        restoreOriginalPasswordBeforeSso: enabled && provider && data.restoreOriginalPasswordBeforeSso ? 1 : 0
    };
}

function restorePasswordCiphertextInput(data) {
    const value = String(data.restoreOriginalPasswordCiphertext || '').trim();
    if (value.length > 4096 || [...value].some(char => char.charCodeAt(0) < 32)) {
        const error = new Error('原始密文格式无效');
        error.status = 400;
        throw error;
    }
    return value;
}

function decodeAdminEntryCredentials(value) {
    if (!value) return { username: '', password: '' };
    try {
        const parsed = JSON.parse(decryptSecretValue(value));
        return {
            username: String(parsed.username || ''),
            password: String(parsed.password || '')
        };
    } catch {
        throw Object.assign(new Error('管理员接口账户凭据无法解密'), { status: 500 });
    }
}

function adminEntrySelection(data, previousEncrypted = '') {
    const supported = ['java', 'net'].includes(String(data.ssoMethod || ''));
    const requested = data.adminEntryEnabled === true || data.adminEntryEnabled === 1
        || data.adminEntryEnabled === '1' || data.adminEntryEnabled === 'true';
    if (!supported || !requested) {
        return { enabled: 0, encrypted: null, username: '', hasPassword: false };
    }

    const previous = decodeAdminEntryCredentials(previousEncrypted);
    const username = String(data.adminEntryUsername ?? previous.username ?? '').trim();
    const passwordInput = typeof data.adminEntryPassword === 'string' ? data.adminEntryPassword : '';
    const password = passwordInput || previous.password;
    const hasControlCharacter = value => [...value].some(char => char.charCodeAt(0) < 32);
    if (!username || username.length > 128 || hasControlCharacter(username)) {
        throw Object.assign(new Error('请填写有效的 Admin/root 账号'), { status: 400 });
    }
    if (!password || password.length > 512 || hasControlCharacter(password)) {
        throw Object.assign(new Error('请填写有效的 Admin/root 密码'), { status: 400 });
    }
    return {
        enabled: 1,
        encrypted: encryptSecretValue(JSON.stringify({ username, password })),
        username,
        hasPassword: true
    };
}

function publicCompetitionMutation(data, extra = {}) {
    const result = { ...data, ...extra };
    delete result.adminEntryPassword;
    return result;
}

async function persistOfficialCardAddress(data) {
    const method = String(data.ssoMethod || '');
    if (!method) return null;
    const [rows] = await pool.query('SELECT id, config_data FROM sso_configs ORDER BY id DESC');
    const record = rows.find(row => {
        try {
            const candidate = decodeStoredConfig(row.config_data || {});
            return candidate.method === method && candidate.canaryOnly !== true;
        } catch { return false; }
    }) || null;
    if (!record) {
        const error = new Error('请先在免密登录配置中保存该接入方式的凭据');
        error.status = 400;
        throw error;
    }
    const config = decodeStoredConfig(record.config_data || {});
    if (config.method !== method) {
        const error = new Error('竞赛卡片接入方式与所选 SSO 配置不一致');
        error.status = 400;
        throw error;
    }
    validateOfficialCardAddress(method, data.url);
    return record.id;
}

// ==========================================
// 🟢 获取当前用户可见竞赛
// ==========================================
router.get("/", authMiddleware, async (req, res) => {
    try {
        const query = `
                SELECT
                    c.id, c.title, c.subtitle, c.url, c.category, c.status_text AS statusText,
                    c.description, c.color, c.custom_icon AS customIcon, c.logo_background AS logoBackground,
                    c.unlock_time AS unlockTime, c.lock_time AS lockTime, c.custom_prompt AS customPrompt,
                    c.sso_config_id AS ssoConfigId, c.sso_method AS ssoMethod, c.class_type AS classType,
                    c.account_api_id AS accountApiId, c.account_db_provider AS accountDbProvider, c.account_db_name AS accountDbName,
                    c.account_table_name AS accountTableName,
                    c.account_username_column AS accountUsernameColumn,
                    c.account_password_column AS accountPasswordColumn,
                    c.account_password_algorithm AS accountPasswordAlgorithm,
                    c.manual_credential_enabled AS manualCredentialEnabled,
                    c.restore_original_password_before_sso AS restoreOriginalPasswordBeforeSso,
                    c.restore_original_password_ciphertext AS restoreOriginalPasswordCiphertext,
                    CASE WHEN c.restore_original_password_ciphertext IS NOT NULL
                              AND c.restore_original_password_ciphertext != '' THEN 1 ELSE 0 END
                        AS hasRestoreOriginalPasswordCiphertext,
                    c.admin_entry_enabled AS adminEntryEnabled,
                    c.admin_entry_credentials AS adminEntryCredentials,
                    c.class_delete_mapping AS classDeleteMapping,
                    c.paas_v2_plug_flag AS paasV2PlugFlag,
                    c.paas_v2_answer_type AS paasV2AnswerType,
                    c.paas_v2_software_unique AS paasV2SoftwareUnique,
                    c.paas_v2_cover AS paasV2Cover,
                    c.created_at,
                    CASE WHEN uws.id IS NOT NULL THEN 1 ELSE 0 END AS has_executed,
                    EXISTS(
                        SELECT 1 FROM user_platform_account_status pas
                        WHERE pas.user_id = ? AND pas.competition_id = c.id
                          AND pas.login_role = 'teacher' AND pas.student_index = 1
                    ) AS teacherReady,
                    EXISTS(
                        SELECT 1 FROM user_platform_account_status pas
                        WHERE pas.user_id = ? AND pas.competition_id = c.id
                          AND pas.login_role = 'student' AND pas.student_index = 1
                    ) AS studentReady,
                    EXISTS(
                        SELECT 1 FROM user_manual_teacher_credentials mtc
                        WHERE c.manual_credential_enabled = 1
                          AND mtc.user_id = ? AND mtc.competition_id = c.id
                    ) AS manualCredentialActive,
                    EXISTS(
                        SELECT 1 FROM user_competition_expert_accounts eca
                        WHERE eca.user_id = ? AND eca.competition_id = c.id
                          AND eca.status IN ('ready', 'entry_ready')
                    ) AS expertReady,
                    EXISTS(
                        SELECT 1 FROM user_class_removals ucr
                        WHERE ucr.user_id = ? AND ucr.competition_id = c.id
                    ) AS classRemoved
                FROM competitions c
                LEFT JOIN user_workflow_status uws
                       ON c.id = uws.competition_id AND uws.user_id = ?
                ORDER BY c.id DESC
            `;
        const [rows] = await pool.query(query, [
            req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id
        ]);
        const parsedRows = rows.map(row => {
            const parsed = {
                ...row,
                classDeleteMapping: row.classDeleteMapping ? JSON.parse(row.classDeleteMapping) : null,
                hasAdminEntryPassword: Boolean(row.adminEntryCredentials)
            };
            if (isSuperAdmin(req.user) && row.adminEntryCredentials) {
                parsed.adminEntryUsername = decodeAdminEntryCredentials(row.adminEntryCredentials).username;
            }
            delete parsed.adminEntryCredentials;
            if (!isSuperAdmin(req.user)) delete parsed.restoreOriginalPasswordCiphertext;
            return parsed;
        });
        const visibleRows = await filterCompetitionsForUser(req.user, parsedRows);
        res.json(visibleRows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 🟢 新增：标记工作流为已执行 (持久化到数据库)
// ==========================================
router.post("/:id/complete", authMiddleware, async (req, res) => {
    try {
        await assertCompetitionAccess(req.user, req.params.id);
        const userId = req.user.id;
        const competitionId = req.params.id;

        await pool.query(
            "INSERT IGNORE INTO user_workflow_status (user_id, competition_id) VALUES (?, ?)",
            [userId, competitionId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(err.status || 500).json({ error: err.message || "状态记录失败" });
    }
});

// ==========================================
// 🔐 新增竞赛 (Admin)
// ==========================================
router.post("/", authMiddleware, adminOnly, async (req, res) => {
    const d = req.body;
    try {
        const times = competitionTimes(d);
        const accountDb = accountDatabaseSelection(d);
        const restoreCiphertextInput = restorePasswordCiphertextInput(d);
        const storedRestoreCiphertext = accountDb.restoreOriginalPasswordBeforeSso && restoreCiphertextInput
            ? restoreCiphertextInput : null;
        const adminEntry = adminEntrySelection(d);
        const effectiveSsoConfigId = await persistOfficialCardAddress(d);
        const classType = ['java', 'net', 'marketing', 'commerce', 'managementAccounting',
            'crossBorderCommerce', 'enterpriseManagement'].includes(d.ssoMethod)
            && [1, 2, 3].includes(Number(d.classType)) ? Number(d.classType) : null;
        const [result] = await pool.query(
            `INSERT INTO competitions (title, subtitle, url, category, status_text, description, color, custom_icon, logo_background, unlock_time, lock_time, custom_prompt, sso_config_id, sso_method, class_type, account_api_id, account_db_provider, account_db_name, account_table_name, account_username_column, account_password_column, account_password_algorithm, manual_credential_enabled, restore_original_password_before_sso, restore_original_password_ciphertext, admin_entry_enabled, admin_entry_credentials, class_delete_mapping, paas_v2_plug_flag, paas_v2_answer_type, paas_v2_software_unique, paas_v2_cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [
                d.title, d.subtitle, d.url, d.category, d.statusText, d.description, d.color, d.customIcon,
                d.logoBackground || 'transparent',
                times.unlockTime,
                times.lockTime,
                d.customPrompt, effectiveSsoConfigId, d.ssoMethod || null, classType, accountDb.apiId, accountDb.provider, accountDb.name, accountDb.table, accountDb.usernameColumn, accountDb.passwordColumn, accountDb.passwordAlgorithm, accountDb.manualCredentialEnabled, accountDb.restoreOriginalPasswordBeforeSso, storedRestoreCiphertext, adminEntry.enabled, adminEntry.encrypted, classDeleteSelection(d), d.paasV2PlugFlag || null, d.paasV2AnswerType || null, d.paasV2SoftwareUnique || null, d.paasV2Cover || null
            ]
        );
        res.json(publicCompetitionMutation(d, {
            id: result.insertId,
            hasRestoreOriginalPasswordCiphertext: Boolean(storedRestoreCiphertext),
            hasAdminEntryPassword: adminEntry.hasPassword
        }));
    } catch (err) {
        console.error('[competitions-create]', err, err?.cause);
        res.status(err.status || 500).json({ error: err?.message || '创建竞赛失败', cause: err?.cause?.message || '' });
    }
});

// ==========================================
// 🔐 更新竞赛 (Admin)
// ==========================================
router.put("/:id", authMiddleware, adminOnly, async (req, res) => {
    const d = req.body;
    try {
        const times = competitionTimes(d);
        const accountDb = accountDatabaseSelection(d);
        const restoreCiphertextInput = restorePasswordCiphertextInput(d);
        const [storedRows] = await pool.query(
            'SELECT restore_original_password_ciphertext AS restoreOriginalPasswordCiphertext, admin_entry_credentials AS adminEntryCredentials FROM competitions WHERE id = ? LIMIT 1',
            [req.params.id]
        );
        if (!storedRows.length) return res.status(404).json({ error: '竞赛不存在' });
        const storedRestoreCiphertext = accountDb.restoreOriginalPasswordBeforeSso
            ? (restoreCiphertextInput
                ? restoreCiphertextInput
                : storedRows[0].restoreOriginalPasswordCiphertext || null)
            : null;
        const adminEntry = adminEntrySelection(d, storedRows[0].adminEntryCredentials || '');
        const effectiveSsoConfigId = await persistOfficialCardAddress(d);
        const classType = ['java', 'net', 'marketing', 'commerce', 'managementAccounting',
            'crossBorderCommerce', 'enterpriseManagement'].includes(d.ssoMethod)
            && [1, 2, 3].includes(Number(d.classType)) ? Number(d.classType) : null;
        const [result] = await pool.query(
            `UPDATE competitions SET title=?, subtitle=?, url=?, category=?, status_text=?, description=?, color=?, custom_icon=?, logo_background=?, unlock_time=?, lock_time=?, custom_prompt=?, sso_config_id=?, sso_method=?, class_type=?, account_api_id=?, account_db_provider=?, account_db_name=?, account_table_name=?, account_username_column=?, account_password_column=?, account_password_algorithm=?, manual_credential_enabled=?, restore_original_password_before_sso=?, restore_original_password_ciphertext=?, admin_entry_enabled=?, admin_entry_credentials=?, class_delete_mapping=?, paas_v2_plug_flag=?, paas_v2_answer_type=?, paas_v2_software_unique=?, paas_v2_cover=? WHERE id=?`,
            [
                d.title, d.subtitle, d.url, d.category, d.statusText, d.description, d.color, d.customIcon,
                d.logoBackground || 'transparent',
                times.unlockTime,
                times.lockTime,
                d.customPrompt, effectiveSsoConfigId, d.ssoMethod || null, classType, accountDb.apiId, accountDb.provider, accountDb.name, accountDb.table, accountDb.usernameColumn, accountDb.passwordColumn, accountDb.passwordAlgorithm, accountDb.manualCredentialEnabled, accountDb.restoreOriginalPasswordBeforeSso, storedRestoreCiphertext, adminEntry.enabled, adminEntry.encrypted, classDeleteSelection(d), d.paasV2PlugFlag || null, d.paasV2AnswerType || null, d.paasV2SoftwareUnique || null, d.paasV2Cover || null,
                req.params.id
            ]
        );
        if (!result.affectedRows) return res.status(404).json({ error: '竞赛不存在' });
        await pool.query('DELETE FROM user_workflow_status WHERE competition_id = ?', [req.params.id]);
        res.json(publicCompetitionMutation(d, {
            id: req.params.id,
            has_executed: 0,
            hasRestoreOriginalPasswordCiphertext: Boolean(storedRestoreCiphertext),
            hasAdminEntryPassword: adminEntry.hasPassword
        }));
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ==========================================
// 🔐 删除竞赛 (Admin)
// ==========================================
router.delete("/:id", authMiddleware, adminOnly, async (req, res) => {
    try {
        const [[competition]] = await pool.query('SELECT id FROM competitions WHERE id = ? LIMIT 1', [req.params.id]);
        if (!competition) return res.status(404).json({ error: '竞赛不存在' });
        const statements = [
            "DELETE FROM user_competition_student_accounts WHERE competition_id = ?",
            "DELETE FROM user_manual_teacher_credentials WHERE competition_id = ?",
            "DELETE FROM user_competition_expert_student_bindings WHERE competition_id = ?",
            "DELETE FROM user_competition_expert_accounts WHERE competition_id = ?",
            "DELETE FROM user_class_removals WHERE competition_id = ?",
            "DELETE FROM user_workflow_status WHERE competition_id = ?",
            "DELETE FROM user_platform_account_status WHERE competition_id = ?",
            "DELETE FROM user_permissions WHERE competition_id = ?",
            "DELETE FROM user_competition_time_rules WHERE competition_id = ?",
            "DELETE FROM competitions WHERE id = ?"
        ].map(sql => [sql, [req.params.id]]);
        await pool.batch(statements);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/batch-delete", authMiddleware, adminOnly, async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.ids)
            ? req.body.ids.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)
            : [];
        if (!ids.length) return res.status(400).json({ error: '请提供需要删除的卡片编号' });
        const placeholders = ids.map(() => '?').join(',');
        const statements = [
            "user_competition_student_accounts",
            "user_manual_teacher_credentials",
            "user_competition_expert_student_bindings",
            "user_competition_expert_accounts",
            "user_class_removals",
            "user_workflow_status",
            "user_platform_account_status",
            "user_permissions",
            "user_competition_time_rules"
        ].map(table => `DELETE FROM ${table} WHERE competition_id IN (${placeholders})`);
        statements.push(`DELETE FROM competitions WHERE id IN (${placeholders})`);
        await pool.batch(statements.map(sql => [sql, ids]));
        res.json({ success: true, deleted: ids.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch("/:id/paas-v2-cover", authMiddleware, adminOnly, async (req, res) => {
    try {
        const cover = typeof req.body?.cover === 'string' ? req.body.cover.trim() : '';
        const [result] = await pool.query('UPDATE competitions SET paas_v2_cover = ? WHERE id = ?', [cover || null, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: '竞赛不存在' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;


