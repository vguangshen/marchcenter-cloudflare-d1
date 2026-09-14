import express from '../compat/express.js';
import pool from '../config/db.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildManualCredentialTarget } from '../utils/officialCompat/manualCredentialTarget.js';
import { deletePlatformStudent } from '../utils/platformJumpDispatcher.js';
import {
    deletePlatformClass,
    executePlatformJump, preflightPlatformJump
} from '../utils/platformJumpDispatcher.js';
import {
    mapMarchCenterToOfficialParameters,
    selectOfficialBaseUrl
} from '../utils/officialCompat/officialJumpConfig.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { isSuperAdmin, normalizeRole, ROLES } from '../utils/roleAccess.js';
import { decodeStoredConfig, decryptSecretValue, encryptSecretValue } from '../utils/configSecrets.js';
import { withD1Lock } from '../utils/d1Lock.js';
import { getEnv, getRuntime, waitUntil } from '../config/runtime.js';
import {
    isPlatformAccountReady, markPlatformAccountReady
} from '../utils/platformAccountStatus.js';
import { issueManualCredential, restoreOriginalPassword, deletePlatformClass as deleteManagedPlatformClass, isClassDeleteMappingReady } from '../utils/accountManagementApi.js';
import { readAccountManagementConfig } from '../utils/accountManagementStore.js';
import {
    mapCardAddressToOfficialConfig,
    validateOfficialTransportAddress
} from '../utils/officialCompat/cardAddress.js';
import { normalizeExpertName } from '../utils/officialCompat/java/expertJump.js';
import { normalizeNetExpertName } from '../utils/officialCompat/net/expertJump.js';
import { buildNetAdminLoginPreparation } from '../utils/officialCompat/net/adminLogin.js';
import { buildJavaAdminLoginPreparation } from '../utils/officialCompat/java/adminLogin.js';
import {
    consumeAdminEntryLaunchToken,
    issueAdminEntryLaunchToken
} from '../utils/adminEntryLaunchToken.js';
import { getExpertEntryContract } from '../utils/officialCompat/expertEntryContract.js';
import {
    buildExpertStudentBindingUrl,
    resolveNetExpertTicket
} from '../utils/officialCompat/expertStudentBinding.js';
import { attachSsoModuleInitRoutes } from './ssoModuleInit.js';

const router = express.Router();
const ALLOWED_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement', 'direct', 'paasV2'
]);
const ACCOUNT_CAPABLE_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
]);
const CLASS_DELETE_METHODS = new Set([
    'java', 'net', 'marketing', 'commerce',
    'managementAccounting', 'crossBorderCommerce', 'enterpriseManagement'
]);

// The Worker composition root may provide one isolate-scoped token store for
// all requests.  Route/unit tests that do not run inside the Worker runtime
// intentionally receive no override and therefore keep request-local state.
function officialDependencyOverrides() {
    try {
        const tokenStore = getRuntime().officialTokenStore;
        return tokenStore ? { officialTokenStore: tokenStore } : {};
    } catch {
        return {};
    }
}

async function withNamedLock(name, action) {
    // 完整跳转最坏情况：SOAP 教师流程约 6 次远端操作 × 20s 超时 × 3 次
    // 整方法重试 ≈ 360s。租期给足 6 分钟，避免慢平台执行期间锁提前过期
    // 导致同一用户并发请求重复建号；并发请求仍会在 10s 内返回 409。
    return withD1Lock(name, action, { waitMs: 10000, leaseMs: 6 * 60 * 1000 });
}

// Evaluator targets belong to one concrete competition platform. They must be
// built from the primary platform identity plus that card's successfully
// synchronized additional accounts; MarchCenter class membership is not a
// reliable description of the remote platform roster.
async function readPlatformExpertTargets(actor, competitionId, effectiveConfig, cardUrl) {
    const baseContext = { user: actor, cardUrl, loginRole: 'student', studentIndex: null };
    const primaryIdentity = mapMarchCenterToOfficialParameters(effectiveConfig, baseContext, cardUrl);
    const [additionalStudents] = await pool.query(
        `SELECT student_index AS studentIndex, account_name AS accountName
         FROM user_competition_student_accounts
         WHERE user_id = ? AND competition_id = ? AND status = 'ready'
         ORDER BY student_index`,
        [actor.id, competitionId]
    );
    return [
        {
            rosterIndex: 1,
            displayName: primaryIdentity.loginName,
            accountName: primaryIdentity.loginName,
            context: baseContext
        },
        ...additionalStudents
            .map(row => ({
                rosterIndex: Number(row.studentIndex),
                displayName: String(row.accountName || '').trim(),
                accountName: String(row.accountName || '').trim(),
                context: {
                    ...baseContext,
                    studentIndex: Number(row.studentIndex),
                    accountName: String(row.accountName || '').trim(),
                    loginName: String(row.accountName || '').trim()
                }
            }))
            .filter(target => Number.isInteger(target.rosterIndex)
                && target.rosterIndex > 1 && target.accountName)
    ];
}

async function prepareExpertStudentTarget(target, competitionId, effectiveConfig) {
    const alreadyReady = await isPlatformAccountReady(
        target.context.user.id, competitionId, 'student', target.rosterIndex
    );
    if (alreadyReady) return false;
    await executePlatformJump(effectiveConfig, target.context, officialDependencyOverrides());
    await markPlatformAccountReady(
        target.context.user.id, competitionId, 'student', target.rosterIndex
    );
    return true;
}

function parseConfig(record) {
    try {
        return decodeStoredConfig(record.config_data || {});
    } catch { return {}; }
}

async function resolvePlatformConfig({ configId, method, classType }, context = {}) {
    let record = null;
    let config = null;

    if (method) {
        if (!ALLOWED_METHODS.has(method)) {
            const error = new Error('不支持的免密登录方式');
            error.status = 400;
            throw error;
        }
        const [rows] = await pool.query('SELECT * FROM sso_configs ORDER BY id DESC');
        record = rows.find(row => {
            const candidate = parseConfig(row);
            return candidate.method === method && candidate.canaryOnly !== true;
        }) || null;
        config = {
            className: '默认班级',
            teacherUserName: 'teacher',
            roleName: 'student',
            loginRole: 'student',
            flag: '1',
            trainOrExam: 'train',
            classPrefix: 'mc',
            teacherPrefix: 'mc',
            studentPrefix: 'mcs',
            studentSuffix: '1',
            expertPrefix: 'mcpw',
            ...(record ? parseConfig(record) : {}),
            method,
            ...(classType ? { classType: Number(classType) } : {}),
            allowHttp: Boolean(record
                ? parseConfig(record).allowHttp
                : getEnv('ALLOW_HTTP_PLATFORMS') === 'true')
        };
    } else if (configId) {
        const [rows] = await pool.query('SELECT * FROM sso_configs WHERE id = ?', [configId]);
        if (!rows.length) {
            const error = new Error('免密登录配置不存在');
            error.status = 404;
            throw error;
        }
        record = rows[0];
        config = { ...parseConfig(record), ...(classType ? { classType: Number(classType) } : {}) };
        if (config.canaryOnly === true) {
            const error = new Error('专用 canary 配置不能通过普通 SSO 路由执行');
            error.status = 403;
            throw error;
        }
    } else {
        const error = new Error('请选择一种免密登录方式');
        error.status = 400;
        throw error;
    }

    delete config.adapterMode;
    delete config.instanceVariant;
    const storedEffectiveConfig = { ...config, baseUrl: config.baseUrl || record?.base_url || '' };
    const effectiveConfig = context && Object.prototype.hasOwnProperty.call(context, 'cardUrl')
        ? mapCardAddressToOfficialConfig(storedEffectiveConfig, context.cardUrl)
        : storedEffectiveConfig;
    return { record, config, effectiveConfig };
}

async function executeSsoRequest(req, body = {}, { onStage } = {}) {
    const { configId, method, competitionId, context = {}, dryRun = false } = body || {};
    const emittedStages = new Set();
    let dedupeStageCallbacks = false;
    const reportStage = async (stage, message = '') => {
        if (dedupeStageCallbacks && emittedStages.has(stage)) return;
        emittedStages.add(stage);
        if (typeof onStage === 'function') await onStage(stage, message);
    };
    let trustedConfig = { configId, method };
    let trustedContext = { ...context, user: req.user, onStage: reportStage };
    let accountWasReady = false;
    let restoreCard = null;
    let manualCredentialActive = false;
    const accountRole = normalizeRole(req.user.role);
    trustedContext.loginRole = accountRole === ROLES.STUDENT
        ? 'student'
        : (context.loginRole === 'teacher' ? 'teacher' : 'student');

    await reportStage('check_connection', '正在检查平台连接与配置…');

    if (competitionId) {
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            `SELECT id, url, unlock_time AS unlockTime, lock_time AS lockTime,
                    sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType,
                    account_api_id AS accountApiId, account_db_name AS accountDbName,
                    account_table_name AS accountTableName,
                    account_username_column AS accountUsernameColumn,
                    account_password_column AS accountPasswordColumn,
                    account_password_algorithm AS accountPasswordAlgorithm,
                    manual_credential_enabled AS manualCredentialEnabled,
                    restore_original_password_before_sso AS restoreOriginalPasswordBeforeSso,
                    restore_original_password_ciphertext AS restoreOriginalPasswordCiphertext,
                    paas_v2_plug_flag AS paasV2PlugFlag,
                    paas_v2_answer_type AS paasV2AnswerType,
                    paas_v2_software_unique AS paasV2SoftwareUnique
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) {
            const error = new Error('竞赛卡片不存在');
            error.status = 404;
            throw error;
        }
        const card = cards[0];
        restoreCard = card;
        trustedConfig = {
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType,
            plugFlag: card.paasV2PlugFlag || null,
            answerType: card.paasV2AnswerType || null,
            softwareUnique: card.paasV2SoftwareUnique || null
        };
        trustedContext.cardUrl = card.url;
        trustedContext.startTime = card.unlockTime || null;
        trustedContext.endTime = card.lockTime || null;
        const requestedStudentIndex = Number(trustedContext.studentIndex);
        if (Number.isInteger(requestedStudentIndex) && requestedStudentIndex > 1) {
            const [accounts] = await pool.query(
                `SELECT id, account_name AS accountName FROM user_competition_student_accounts
                 WHERE user_id = ? AND competition_id = ? AND student_index = ? AND status = 'ready'`,
                [req.user.id, competitionId, requestedStudentIndex]
            );
            if (!accounts.length) {
                const error = new Error('学生子账号不存在或尚未就绪');
                error.status = 403;
                throw error;
            }
            trustedContext.accountName = accounts[0].accountName;
            accountWasReady = await isPlatformAccountReady(
                req.user.id, competitionId, 'student', requestedStudentIndex
            );
        } else {
            trustedContext.studentIndex = null;
            accountWasReady = await isPlatformAccountReady(
                req.user.id, competitionId, trustedContext.loginRole, 1
            );
        }
        trustedContext.accountWasReady = accountWasReady;
        if (Number(card.manualCredentialEnabled) === 1 && card.restoreOriginalPasswordBeforeSso) {
            const [manualRows] = await pool.query(
                `SELECT username FROM user_manual_teacher_credentials
                 WHERE user_id = ? AND competition_id = ? LIMIT 1`,
                [req.user.id, competitionId]
            );
            manualCredentialActive = manualRows.length > 0;
        }
    } else if (!isSuperAdmin(req.user)) {
        const error = new Error('普通用户必须通过竞赛卡片执行免密登录');
        error.status = 403;
        throw error;
    }

    const { config, effectiveConfig } = await resolvePlatformConfig(trustedConfig, trustedContext);
    if (trustedConfig.method === 'paasV2') {
        for (const field of ['plugFlag', 'answerType', 'softwareUnique']) {
            if (trustedConfig[field] !== null && trustedConfig[field] !== undefined) {
                effectiveConfig[field] = trustedConfig[field];
                config[field] = trustedConfig[field];
            }
        }
    }
    dedupeStageCallbacks = true;

    if (!config.method || !ALLOWED_METHODS.has(config.method)) {
        const error = new Error('该配置未绑定新版免密登录接口');
        error.status = 400;
        throw error;
    }
    if (dryRun) {
        const preflight = await preflightPlatformJump(effectiveConfig, trustedContext);
        const checks = Array.isArray(preflight)
            ? preflight
            : [
                `已选择 ${preflight.adapter}`,
                `已匹配服务：${preflight.serviceName}`,
                `目标地址校验通过：${preflight.target.protocol}//${preflight.target.host}${preflight.target.path}`,
                `最终地址规则：${preflight.urlRule}`
            ];
        await reportStage('prepare_entry', '配置检查完成');
        return { success: true, checks, accountWasReady };
    }
    let passwordRestored = false;
    const executeJump = async () => {
        if (
            competitionId
            && manualCredentialActive
            && Number(restoreCard?.manualCredentialEnabled) === 1
            && restoreCard?.restoreOriginalPasswordBeforeSso
        ) {
            const [pendingRows] = await pool.query(
                `SELECT 1 FROM user_manual_teacher_credentials
                 WHERE user_id = ? AND competition_id = ? LIMIT 1`,
                [req.user.id, competitionId]
            );
            if (pendingRows.length) {
                await reportStage('create_account', '正在恢复平台账号的免密状态…');
                const restoreContext = {
                    ...trustedContext,
                    loginRole: 'teacher',
                    studentIndex: null
                };
                const target = buildManualCredentialTarget(effectiveConfig, restoreContext);
                const accountApiConfig = await readAccountManagementConfig(restoreCard.accountApiId || '');
                if (!accountApiConfig) {
                    const error = new Error('无法恢复免密登录：竞赛卡片绑定的账号管理 API 不可用');
                    error.status = 409;
                    throw error;
                }
                await restoreOriginalPassword(
                    accountApiConfig,
                    target.system,
                    target.username,
                    restoreCard.url,
                    restoreCard.accountDbName,
                    restoreCard.accountTableName,
                    restoreCard.accountUsernameColumn,
                    restoreCard.accountPasswordColumn,
                    restoreCard.accountPasswordAlgorithm,
                    restoreCard.restoreOriginalPasswordCiphertext || ''
                );
                await pool.query(
                    `DELETE FROM user_manual_teacher_credentials
                     WHERE user_id = ? AND competition_id = ?`,
                    [req.user.id, competitionId]
                );
                passwordRestored = true;
            }
        }
        return executePlatformJump(effectiveConfig, trustedContext, officialDependencyOverrides());
    };
    const executed = competitionId && (!accountWasReady || manualCredentialActive)
        ? await withNamedLock(
            manualCredentialActive
                ? `mc-sso-${req.user.id}-${competitionId}-password-restore`
                : `mc-sso-${req.user.id}-${competitionId}-${trustedContext.loginRole}-${trustedContext.studentIndex || 1}`,
            executeJump
        )
        : await executeJump();
    const redirectUrl = typeof executed === 'string' ? executed : null;
    const postForm = executed && typeof executed === 'object' && executed.postForm ? executed.postForm : null;
    if (competitionId) {
        await markPlatformAccountReady(
            req.user.id,
            competitionId,
            trustedContext.loginRole,
            trustedContext.studentIndex || 1
        );
    }
    await reportStage('prepare_entry', '入口已准备完成');
    return { success: true, redirectUrl, postForm, adapter: effectiveConfig.serviceName, accountWasReady, passwordRestored };
}

router.post('/execute/stream', authMiddleware, async (req, res) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            let closed = false;
            const send = (event, data) => {
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                } catch { closed = true; }
            };
            (async () => {
                try {
                    const result = await executeSsoRequest(req, req.body, {
                        onStage: (stage, message) => send('stage', { stage, message })
                    });
                    send('result', { data: result });
                } catch (error) {
                    send('error', { error: error.message || '免密登录执行失败', status: error.status || 500 });
                } finally {
                    if (!closed) {
                        closed = true;
                        try { controller.close(); } catch { /* client disconnected */ }
                    }
                }
            })();
        },
        cancel() {}
    });
    return res.stream(stream, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
    });
});

router.post('/execute', authMiddleware, async (req, res) => {
    try {
        return res.json(await executeSsoRequest(req, req.body));
    } catch (error) {
        console.error('[SSO] 执行失败：', error.message);
        return res.status(error.status || 500).json({ error: error.message || '免密登录执行失败' });
    }
});

router.post('/account-readiness/:competitionId/repair', authMiddleware, async (req, res) => {
    if (normalizeRole(req.user.role) === ROLES.STUDENT) {
        return res.status(403).json({ error: '学生账号不能操作系统维护入口' });
    }
    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }
    try {
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            'SELECT sso_method AS ssoMethod FROM competitions WHERE id = ? LIMIT 1',
            [competitionId]
        );
        const card = cards[0];
        if (!card) return res.status(404).json({ error: '竞赛卡片不存在' });
        if (!['java', 'net', 'marketing', 'commerce', 'managementAccounting',
            'crossBorderCommerce', 'enterpriseManagement'].includes(card.ssoMethod)) {
            return res.status(409).json({ error: '当前平台不支持账号同步维护' });
        }
        {
            let result;
            try {
                result = await withNamedLock(
                    `mc-login-repair-${req.user.id}-${competitionId}`,
                    async () => {
                    await pool.query(
                        'DELETE FROM user_platform_account_status WHERE user_id = ? AND competition_id = ?',
                        [req.user.id, competitionId]
                    );
                    await pool.query(
                        'DELETE FROM user_competition_expert_student_bindings WHERE user_id = ? AND competition_id = ?',
                        [req.user.id, competitionId]
                    );
                    const [studentAccounts] = await pool.query(
                        `SELECT student_index AS studentIndex
                         FROM user_competition_student_accounts
                         WHERE user_id = ? AND competition_id = ? AND status = 'ready'
                         ORDER BY student_index`,
                        [req.user.id, competitionId]
                    );
                    const repaired = [];
                    await executeSsoRequest(req, {
                        competitionId,
                        context: { loginRole: 'teacher' }
                    });
                    repaired.push({ loginRole: 'teacher', studentIndex: 1 });
                    await executeSsoRequest(req, {
                        competitionId,
                        context: { loginRole: 'student', studentIndex: null }
                    });
                    repaired.push({ loginRole: 'student', studentIndex: 1 });
                    for (const account of studentAccounts) {
                        const studentIndex = Number(account.studentIndex);
                        if (!Number.isInteger(studentIndex) || studentIndex < 2) continue;
                        await executeSsoRequest(req, {
                            competitionId,
                            context: { loginRole: 'student', studentIndex }
                        });
                        repaired.push({ loginRole: 'student', studentIndex });
                    }
                        return repaired;
                    }
                );
            } catch (error) {
                await pool.query(
                    'DELETE FROM user_platform_account_status WHERE user_id = ? AND competition_id = ?',
                    [req.user.id, competitionId]
                ).catch(() => {});
                await pool.query(
                    'DELETE FROM user_competition_expert_student_bindings WHERE user_id = ? AND competition_id = ?',
                    [req.user.id, competitionId]
                ).catch(() => {});
                throw error;
            }
            return res.json({
                success: true,
                mode: card.ssoMethod === 'java' ? 'java_repaired' : 'soap_repaired',
                repaired: result
            });
        }
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '重新校验准备失败'
        });
    }
});

/**
 * Prepare the original evaluator entry for Java and .NET platforms.
 *
 * The recovered Java platform decrypts expertuserdata at /open/toExpertPage;
 * getExpertName() then creates/reuses a type-4 evaluator and initializes its
 * student/module association before returning the evaluator page. The legacy
 * .NET/e-commerce branch first asks the vendor's loaduserscore endpoint for
 * the selected student's remote evaluator ticket, then opens
 * /login.aspx?op=expertlogin with that returned ticket. MarchCenter only
 * prepares the student prerequisite and the vendor-native browser entry; it
 * never treats the student account as the evaluator account.
 */
router.post('/expert-accounts/:competitionId', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    if (normalizeRole(req.user.role) === ROLES.STUDENT) {
        return res.status(403).json({ error: '学生账号不能进入评委端' });
    }

    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }

    try {
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType
             FROM competitions WHERE id = ? LIMIT 1`,
            [competitionId]
        );
        const card = cards[0];
        if (!card) return res.status(404).json({ error: '竞赛卡片不存在' });
        if (!['java', 'net'].includes(card.ssoMethod)) {
            return res.status(400).json({ error: '当前竞赛平台暂不支持评委端' });
        }

        const baseContext = {
            user: req.user,
            cardUrl: card.url,
            loginRole: 'student',
            studentIndex: null
        };
        const { effectiveConfig } = await resolvePlatformConfig({
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType
        }, baseContext);
        await validateOfficialTransportAddress(effectiveConfig, baseContext);

        const prepared = await withNamedLock(
            `mc-expert-${req.user.id}-${competitionId}`,
            async () => {
                const [existingRows] = await pool.query(
                    `SELECT account_name AS accountName
                     FROM user_competition_expert_accounts
                     WHERE user_id = ? AND competition_id = ? LIMIT 1`,
                    [req.user.id, competitionId]
                );
                const requestedName = typeof req.body?.expertName === 'string'
                    ? req.body.expertName.trim()
                    : '';
                const defaultName = `${String(effectiveConfig.expertPrefix ?? 'mcpw').trim() || 'mcpw'}${req.user.username}`;
                const expertName = (card.ssoMethod === 'java'
                    ? normalizeExpertName
                    : normalizeNetExpertName)(
                    requestedName || existingRows[0]?.accountName || defaultName,
                    defaultName
                );

                const targets = await readPlatformExpertTargets(
                    req.user, competitionId, effectiveConfig, card.url
                );
                if (!targets.length) {
                    const error = new Error('目标平台还没有可评审的学生账号');
                    error.status = 409;
                    throw error;
                }

                const requestedStudentIndex = Number(req.body?.studentIndex ?? 1);
                const selectedStudent = targets.find(
                    target => target.rosterIndex === requestedStudentIndex
                );
                if (!selectedStudent) {
                    const error = new Error('未找到目标平台中的对应学生账号');
                    error.status = 404;
                    throw error;
                }
                const newlyPrepared = await prepareExpertStudentTarget(
                    selectedStudent, competitionId, effectiveConfig
                );

                // 用户只等待当前选择的学生。其余班级账号在响应后尽力预热，
                // 下一次点击对应标签时通常可以直接取得评委票据。
                const remainingTargets = targets.filter(target => target !== selectedStudent);
                if (remainingTargets.length) {
                    waitUntil((async () => {
                        for (const target of remainingTargets) {
                            try {
                                await withNamedLock(
                                    `mc-expert-student-${req.user.id}-${competitionId}-${target.rosterIndex}`,
                                    () => prepareExpertStudentTarget(target, competitionId, effectiveConfig)
                                );
                            } catch (error) {
                                console.warn('[SSO] 评委学生后台预热失败：', {
                                    competitionId,
                                    studentIndex: target.rosterIndex,
                                    message: error.message
                                });
                            }
                        }
                    })());
                }
                const redirectUrl = card.ssoMethod === 'net'
                    ? await resolveNetExpertTicket({
                        baseUrl: card.url,
                        config: effectiveConfig,
                        expertName,
                        studentAccountName: selectedStudent.accountName
                    })
                    : buildExpertStudentBindingUrl(
                        card.ssoMethod,
                        card.url,
                        effectiveConfig,
                        expertName,
                        selectedStudent.accountName
                    );
                await pool.query(
                    `INSERT INTO user_competition_expert_accounts
                        (user_id, competition_id, account_name, status, updated_at)
                     VALUES (?, ?, ?, 'entry_ready', CURRENT_TIMESTAMP)
                     ON CONFLICT(user_id, competition_id) DO UPDATE SET
                        account_name = excluded.account_name,
                        status = 'entry_ready',
                        updated_at = CURRENT_TIMESTAMP`,
                    [req.user.id, competitionId, expertName]
                );
                return {
                    expertName,
                    studentLoginName: selectedStudent.accountName,
                    studentLoginNames: targets.map(target => target.accountName),
                    selectedStudentIndex: selectedStudent.rosterIndex,
                    newlyBoundStudentCount: newlyPrepared ? 1 : 0,
                    redirectUrl,
                    entryContract: getExpertEntryContract(
                        card.ssoMethod,
                        effectiveConfig.expertEntryMode
                    )
                };
            }
        );

        return res.json({
            success: true,
            account: {
                accountName: prepared.expertName,
                studentAccountName: prepared.studentLoginName,
                studentAccountNames: prepared.studentLoginNames,
                selectedStudentIndex: prepared.selectedStudentIndex,
                boundStudentCount: prepared.studentLoginNames.length,
                newlyBoundStudentCount: prepared.newlyBoundStudentCount
            },
            remoteProvisioning: prepared.entryContract,
            redirectUrl: prepared.redirectUrl
        });
    } catch (error) {
        console.error('[SSO] 评委入口失败：', error.message);
        const status = Number(error.statusCode || error.status) || 500;
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '评委入口准备失败'
        });
    }
});

router.get('/admin-credential/:competitionId', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ error: '仅超级管理员可查看平台管理员账户' });
    }
    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }

    try {
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            `SELECT url, sso_method AS ssoMethod,
                    admin_entry_enabled AS adminEntryEnabled,
                    admin_entry_credentials AS adminEntryCredentials
             FROM competitions WHERE id = ? LIMIT 1`,
            [competitionId]
        );
        const card = cards[0];
        if (!card) return res.status(404).json({ error: '竞赛卡片不存在' });
        if (!['java', 'net'].includes(card.ssoMethod) || Number(card.adminEntryEnabled) !== 1 || !card.adminEntryCredentials) {
            return res.status(409).json({ error: '该竞赛卡片尚未配置管理员接口账户服务' });
        }
        const credential = JSON.parse(decryptSecretValue(card.adminEntryCredentials));
        return res.json({
            success: true,
            credential: {
                label: card.ssoMethod === 'java' ? 'Admin' : 'Root',
                loginUrl: card.url,
                username: String(credential.username || ''),
                password: String(credential.password || '')
            }
        });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        console.error('[SSO] 读取平台管理员账户失败：', error.message);
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '读取平台管理员账户失败'
        });
    }
});

router.post('/admin-entry/:competitionId/prepare', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (!isSuperAdmin(req.user)) {
        return res.status(403).json({ error: '仅超级管理员可使用平台管理员自动登录' });
    }
    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }

    try {
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            `SELECT url, sso_method AS ssoMethod,
                    admin_entry_enabled AS adminEntryEnabled,
                    admin_entry_credentials AS adminEntryCredentials
             FROM competitions WHERE id = ? LIMIT 1`,
            [competitionId]
        );
        const card = cards[0];
        if (!card) return res.status(404).json({ error: '竞赛卡片不存在' });
        if (!['java', 'net'].includes(card.ssoMethod)) {
            return res.status(409).json({ error: '管理员自动登录仅适用于 Java 或 .NET 平台' });
        }
        if (Number(card.adminEntryEnabled) !== 1 || !card.adminEntryCredentials) {
            return res.status(409).json({ error: '该竞赛卡片尚未配置管理员账户服务' });
        }

        // Validate the stored target and credentials before issuing the relay
        // ticket, but never send credential-derived fields to the HTTPS app.
        const credential = JSON.parse(decryptSecretValue(card.adminEntryCredentials));
        const preparation = card.ssoMethod === 'java'
            ? buildJavaAdminLoginPreparation(card.url, credential)
            : buildNetAdminLoginPreparation(card.url, credential);
        const launch = await issueAdminEntryLaunchToken({
            userId: req.user.id,
            competitionId
        });
        return res.json({
            success: true,
            preparation: {
                relayPath: `/api/sso/admin-entry/relay/${launch.token}`,
                redirectUrl: preparation.redirectUrl,
                expiresAt: launch.expiresAt
            }
        });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        console.error('[SSO] 管理员自动登录准备失败：', error.message);
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '管理员自动登录准备失败'
        });
    }
});

router.get('/admin-entry/relay/:token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
        const launch = await consumeAdminEntryLaunchToken(req.params.token);
        if (!launch) {
            return res.status(410).send('管理员登录链接已使用或已过期，请返回 MarchCenter 重试。');
        }
        const [cards] = await pool.query(
            `SELECT url, sso_method AS ssoMethod,
                    admin_entry_enabled AS adminEntryEnabled,
                    admin_entry_credentials AS adminEntryCredentials
             FROM competitions WHERE id = ? LIMIT 1`,
            [launch.competitionId]
        );
        const card = cards[0];
        if (!card || !['java', 'net'].includes(card.ssoMethod) || Number(card.adminEntryEnabled) !== 1 || !card.adminEntryCredentials) {
            return res.status(409).send('该竞赛卡片的管理员账户服务已停用。');
        }
        const credential = JSON.parse(decryptSecretValue(card.adminEntryCredentials));
        const preparation = card.ssoMethod === 'java'
            ? buildJavaAdminLoginPreparation(card.url, credential)
            : buildNetAdminLoginPreparation(card.url, credential);
        const loginUrl = new URL(preparation.actionUrl);
        for (const [name, value] of Object.entries(preparation.fields)) {
            loginUrl.searchParams.set(name, String(value ?? ''));
        }
        res.setHeader('Location', loginUrl.toString());
        return res.status(302).send('');
    } catch (error) {
        console.error('[SSO] 管理员登录中转失败：', error.message);
        return res.status(500).send('管理员登录中转失败，请返回 MarchCenter 重试。');
    }
});

router.get('/manual-credential/:competitionId', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }

    try {
        await assertCompetitionAccess(req.user, competitionId);
        if (normalizeRole(req.user.role) === ROLES.STUDENT) {
            return res.status(403).json({ error: '学生账号不提供教师主账号登录信息' });
        }
        const [cards] = await pool.query(
            `SELECT manual_credential_enabled AS manualCredentialEnabled
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
        if (Number(cards[0].manualCredentialEnabled) !== 1) {
            return res.status(409).json({ error: '该竞赛卡片未启用提取账号信息' });
        }
        const [rows] = await pool.query(
            `SELECT username, login_url AS loginUrl, encrypted_password AS encryptedPassword
             FROM user_manual_teacher_credentials
             WHERE user_id = ? AND competition_id = ?`,
            [req.user.id, competitionId]
        );
        if (!rows.length) return res.json({ success: true, credential: null });

        return res.json({
            success: true,
            credential: {
                loginUrl: rows[0].loginUrl,
                username: rows[0].username,
                password: decryptSecretValue(rows[0].encryptedPassword),
                passwordPolicy: 'persistent_until_changed'
            }
        });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        console.error('[SSO] 读取教师长期密码失败：', error.message);
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '读取教师长期密码失败'
        });
    }
});

router.post('/manual-credential', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const competitionId = Number(req.body?.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) {
        return res.status(400).json({ error: '竞赛卡片无效' });
    }

    try {
        await assertCompetitionAccess(req.user, competitionId);
        const accountRole = normalizeRole(req.user.role);
        if (accountRole === ROLES.STUDENT) {
            return res.status(403).json({ error: '学生账号不提供教师主账号登录信息' });
        }

        const [cards] = await pool.query(
            `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType,
                    account_api_id AS accountApiId, account_db_provider AS accountDbProvider, account_db_name AS accountDbName,
                    account_table_name AS accountTableName,
                    account_username_column AS accountUsernameColumn,
                    account_password_column AS accountPasswordColumn,
                    account_password_algorithm AS accountPasswordAlgorithm,
                    manual_credential_enabled AS manualCredentialEnabled,
                    restore_original_password_ciphertext AS restoreOriginalPasswordCiphertext
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
        const card = cards[0];
        if (Number(card.manualCredentialEnabled) !== 1) {
            return res.status(409).json({ error: '该竞赛卡片未启用提取账号信息' });
        }
        if (!ACCOUNT_CAPABLE_METHODS.has(card.ssoMethod)) {
            return res.status(400).json({ error: '当前接入方式不支持提取账号密码' });
        }
        if (!card.accountDbName) {
            return res.status(409).json({ error: '请先在竞赛卡片中选择该软件对应的数据库' });
        }
        if (!card.accountTableName) {
            return res.status(409).json({ error: '请先在竞赛卡片中选择该软件对应的账号数据表' });
        }
        if (!card.accountUsernameColumn || !card.accountPasswordColumn) {
            return res.status(409).json({ error: '请先在竞赛卡片中选择用户名字段和密码字段' });
        }
        if (!card.accountPasswordAlgorithm) {
            return res.status(409).json({ error: '请先在竞赛卡片中选择该软件使用的密码加密算法' });
        }

        const ready = await isPlatformAccountReady(req.user.id, competitionId, 'teacher', 1);
        if (!ready) {
            return res.status(409).json({ error: '请先通过教师端完成教师主账号的首次创建' });
        }

        const context = {
            user: req.user,
            cardUrl: card.url,
            loginRole: 'teacher',
            studentIndex: null
        };
        const { effectiveConfig } = await resolvePlatformConfig({
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType
        }, context);
        const target = buildManualCredentialTarget(effectiveConfig, context);
        const accountApiConfig = await readAccountManagementConfig(card.accountApiId || '');
        if (!accountApiConfig) return res.status(409).json({ error: '该竞赛卡片尚未绑定可用的账号管理 API' });
        const credential = await issueManualCredential(
            accountApiConfig,
            target.system,
            target.username,
            card.url,
            card.accountDbName,
            card.accountTableName,
            card.accountUsernameColumn,
            card.accountPasswordColumn,
            card.accountPasswordAlgorithm
        );
        if (!card.restoreOriginalPasswordCiphertext && credential.originalPasswordCiphertext) {
            await pool.query(
                `UPDATE competitions
                 SET restore_original_password_ciphertext = ?
                 WHERE id = ?
                   AND (restore_original_password_ciphertext IS NULL OR restore_original_password_ciphertext = '')`,
                [credential.originalPasswordCiphertext, competitionId]
            );
        }
        await pool.query(
            `INSERT INTO user_manual_teacher_credentials
                (user_id, competition_id, username, login_url, encrypted_password, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, competition_id) DO UPDATE SET
                username = excluded.username,
                login_url = excluded.login_url,
                encrypted_password = excluded.encrypted_password,
                updated_at = CURRENT_TIMESTAMP`,
            [req.user.id, competitionId, credential.username, target.loginUrl, encryptSecretValue(credential.password)]
        );
        return res.json({
            success: true,
            credential: {
                loginUrl: target.loginUrl,
                username: credential.username,
                password: credential.password,
                passwordPolicy: 'persistent_until_changed'
            }
        });
    } catch (error) {
        const status = Number(error.statusCode || error.status) || 500;
        console.error('[SSO] 提取手动登录信息失败：', error.message);
        return res.status(status >= 400 && status < 600 ? status : 500).json({
            error: error.message || '提取手动登录信息失败'
        });
    }
});

router.get('/student-accounts', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT usa.competition_id AS competitionId, usa.student_index AS studentIndex,
                    usa.account_name AS accountName, usa.created_at AS createdAt,
                    EXISTS(
                        SELECT 1 FROM user_platform_account_status pas
                        WHERE pas.user_id = usa.user_id
                          AND pas.competition_id = usa.competition_id
                          AND pas.login_role = 'student'
                          AND pas.student_index = usa.student_index
                    ) AS platformReady
             FROM user_competition_student_accounts usa
             WHERE usa.user_id = ? AND usa.status = 'ready'
             ORDER BY usa.competition_id, usa.student_index`,
            [req.user.id]
        );
        return res.json(rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || '学生账号读取失败' });
    }
});

router.post('/student-accounts/:competitionId', authMiddleware, async (req, res) => {
    if (normalizeRole(req.user.role) === ROLES.STUDENT) {
        return res.status(403).json({ error: '学生账号不能创建学生子账号' });
    }
    const competitionId = Number(req.params.competitionId);
    if (!Number.isInteger(competitionId) || competitionId < 1) return res.status(400).json({ error: '竞赛卡片无效' });

    let reservationId = null;
    try {
        const [cards] = await pool.query(
            `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
        const card = cards[0];
        await assertCompetitionAccess(req.user, competitionId);
        if (!ACCOUNT_CAPABLE_METHODS.has(card.ssoMethod)) {
            return res.status(400).json({ error: '当前接入方式不支持新增学生账号' });
        }

        const context = { user: req.user, cardUrl: card.url, loginRole: 'student', forceProvision: true };
        const { effectiveConfig } = await resolvePlatformConfig({
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType
        }, context);

        let studentIndex;
        let accountName;
        await withD1Lock(`mc-student-${req.user.id}-${competitionId}`, async () => {
            const [maxRows] = await pool.query(
                'SELECT COALESCE(MAX(student_index), 1) AS maxIndex FROM user_competition_student_accounts WHERE user_id = ? AND competition_id = ?',
                [req.user.id, competitionId]
            );
            studentIndex = Number(maxRows[0].maxIndex) + 1;
            accountName = `${effectiveConfig.studentPrefix ?? 'mcs'}${req.user.username}${studentIndex}`;
            const [insertResult] = await pool.query(
                `INSERT INTO user_competition_student_accounts
                    (user_id, competition_id, student_index, account_name, status)
                 VALUES (?, ?, ?, ?, 'creating')`,
                [req.user.id, competitionId, studentIndex, accountName]
            );
            reservationId = insertResult.insertId;
        }, { waitMs: 5000, leaseMs: 30000 });

        const redirectUrl = await executePlatformJump(effectiveConfig, {
            ...context,
            studentIndex
        }, officialDependencyOverrides());
        await pool.query("UPDATE user_competition_student_accounts SET status = 'ready' WHERE id = ?", [reservationId]);
        await markPlatformAccountReady(req.user.id, competitionId, 'student', studentIndex);
        return res.json({
            success: true,
            account: { competitionId, studentIndex, accountName, platformReady: 1, launchUrl: redirectUrl },
            redirectUrl
        });
    } catch (error) {
        if (reservationId) {
            await pool.query("DELETE FROM user_competition_student_accounts WHERE id = ? AND status = 'creating'", [reservationId]).catch(() => {});
        }
        console.error('[SSO] 新增学生失败：', error.message);
        return res.status(error.status || 500).json({ error: error.message || '新增学生账号失败' });
    }
});

router.delete('/student-accounts/:competitionId/:studentIndex', authMiddleware, async (req, res) => {
    if (normalizeRole(req.user.role) === ROLES.STUDENT) {
        return res.status(403).json({ error: '学生账号不能删除学生子账号' });
    }
    const competitionId = Number(req.params.competitionId);
    const studentIndex = Number(req.params.studentIndex);
    if (!Number.isInteger(competitionId) || competitionId < 1 || !Number.isInteger(studentIndex) || studentIndex < 2) {
        return res.status(400).json({ error: '学生账号参数无效' });
    }

    try {
        const [accounts] = await pool.query(
            `SELECT id, account_name AS accountName
             FROM user_competition_student_accounts
             WHERE user_id = ? AND competition_id = ? AND student_index = ? AND status = 'ready'`,
            [req.user.id, competitionId, studentIndex]
        );
        if (!accounts.length) return res.status(404).json({ error: '学生账号不存在或已删除' });

        const [cards] = await pool.query(
            `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
        const card = cards[0];
        await assertCompetitionAccess(req.user, competitionId);
        if (!ACCOUNT_CAPABLE_METHODS.has(card.ssoMethod)) {
            return res.status(400).json({ error: '当前接入方式不支持删除学生账号' });
        }

        const context = { user: req.user, cardUrl: card.url, loginRole: 'student' };
        const { effectiveConfig } = await resolvePlatformConfig({
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType
        }, context);

        await deletePlatformStudent(
            effectiveConfig,
            context,
            accounts[0].accountName,
            officialDependencyOverrides()
        );
        await pool.query(
            `DELETE FROM user_platform_account_status
             WHERE user_id = ? AND competition_id = ? AND login_role = 'student' AND student_index = ?`,
            [req.user.id, competitionId, studentIndex]
        );
        await pool.query(
            `DELETE FROM user_competition_expert_student_bindings
             WHERE user_id = ? AND competition_id = ? AND student_index = ?`,
            [req.user.id, competitionId, studentIndex]
        );
        await pool.query(
            'DELETE FROM user_competition_student_accounts WHERE id = ? AND user_id = ?',
            [accounts[0].id, req.user.id]
        );
        return res.json({ success: true, accountName: accounts[0].accountName, studentIndex });
    } catch (error) {
        console.error('[SSO] 删除学生失败：', error.message);
        return res.status(error.status || 500).json({ error: error.message || '删除学生账号失败' });
    }
});

// 远端删除当前用户在指定卡片平台上的班级，并在本地标记虚影状态。
// JAVA 平台在下方按 method 分支改走账号管理 API 直删（open-API 删班在真实平台
// 不可靠：YX030505 的 markGroupDeleted 302、YT00123 的 checkClassName 硬编码
// uc_mode=5 导致班级不可见）；.NET/沙盘类 SOAP 平台走 IsGroupExisted + DelGroup。
router.post('/class/remove', authMiddleware, async (req, res) => {
    // 学生账号的认证信息里带有所属教师用户名（classTeacherUsername），
    // 身份映射会优先使用它，导致学生删除的是教师共享班级而非自己的
    // 独立资源；前端隐藏按钮不能替代服务器端权限控制。
    if (normalizeRole(req.user.role) === ROLES.STUDENT) {
        return res.status(403).json({ error: '学生无权删除远程班级' });
    }
    try {
        const competitionId = Number(req.body?.competitionId);
        if (!Number.isInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({ error: '竞赛卡片无效' });
        }
        await assertCompetitionAccess(req.user, competitionId);
        const [cards] = await pool.query(
            `SELECT id, url, sso_method AS ssoMethod, sso_config_id AS ssoConfigId, class_type AS classType,
                    account_api_id AS accountApiId, account_db_name AS accountDbName,
                    class_delete_mapping AS classDeleteMapping
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!cards.length) return res.status(404).json({ error: '竞赛卡片不存在' });
        const card = cards[0];
        if (!CLASS_DELETE_METHODS.has(card.ssoMethod)) {
            return res.status(400).json({ error: '当前接入方式不支持远端删除班级' });
        }

        const context = { user: req.user, cardUrl: card.url, loginRole: 'teacher', studentIndex: null };
        const { effectiveConfig } = await resolvePlatformConfig({
            configId: card.ssoConfigId,
            method: card.ssoMethod,
            classType: card.classType
        }, context);
        const baseUrl = selectOfficialBaseUrl(effectiveConfig, context);
        const identity = mapMarchCenterToOfficialParameters(effectiveConfig, context, baseUrl);
        const [studentRows] = await pool.query(
            `SELECT account_name FROM user_competition_student_accounts
             WHERE user_id = ? AND competition_id = ? ORDER BY student_index`,
            [req.user.id, competitionId]
        );
        const studentAccountList = studentRows.length > 0
            ? studentRows.map(row => row.account_name)
            : (Array.isArray(identity.studentList) && identity.studentList.length > 0 ? identity.studentList : []);
        let outcome;
        if (card.ssoMethod === 'java') {
            // JAVA 平台改走账号管理 API 直删：open-API 删班在真实平台不可靠
            // （YX030505 markGroupDeleted 302、YT00123 checkClassName 按 uc_mode=5
            // 过滤导致班级不可见），直删数据库班级行绕过全部失效接口。
            const mapping = card.classDeleteMapping ? JSON.parse(card.classDeleteMapping) : null;
            if (!isClassDeleteMappingReady(mapping)) {
                return res.status(409).json({ error: '当前未配置 Java 班级删除映射，请先在编辑卡片中开启并填写' });
            }
            const accountApiConfig = await readAccountManagementConfig(mapping.apiId);
            if (!accountApiConfig) {
                return res.status(409).json({ error: '该卡片映射绑定的账号管理 API 不存在或已删除' });
            }
            if (!accountApiConfig.enabled) {
                return res.status(409).json({ error: '所选账号管理 API 已停用' });
            }
            const result = await deleteManagedPlatformClass(accountApiConfig, {
                system: card.ssoMethod,
                platformUrl: card.url,
                databaseName: mapping.databaseName,
                className: identity.className,
                mapping
            });
            outcome = Object.freeze({ deleted: result.deleted === true, groupID: null });
        } else {
            outcome = await deletePlatformClass(effectiveConfig, context, {
                className: identity.className,
                teacherUserName: identity.teacherUserName,
                studentAccountList
            }, officialDependencyOverrides());
        }
        await pool.query(
            `INSERT INTO user_class_removals (user_id, competition_id, removed_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, competition_id) DO UPDATE SET removed_at = CURRENT_TIMESTAMP`,
            [req.user.id, competitionId]
        );
        await pool.query(
            'DELETE FROM user_competition_expert_student_bindings WHERE user_id = ? AND competition_id = ?',
            [req.user.id, competitionId]
        );
        return res.json({
            success: true,
            deleted: outcome.deleted,
            className: identity.className,
            ...(outcome.groupID ? { groupID: outcome.groupID } : {})
        });
    } catch (error) {
        console.error('[SSO] 删除班级失败：', error.message);
        const status = Number(error.status) >= 400 && Number(error.status) < 600
            ? Number(error.status)
            : (Number(error.statusCode) >= 400 && Number(error.statusCode) < 600
                ? Number(error.statusCode)
                : (String(error.code || '').startsWith('OFFICIAL_') ? 502 : 500));
        return res.status(status).json({ error: error.message || '删除班级失败' });
    }
});

// 恢复卡片：清除本地虚影标记；远端班级由下一次正常跳转自动重建。
router.post('/class/restore', authMiddleware, async (req, res) => {
    try {
        const competitionId = Number(req.body?.competitionId);
        if (!Number.isInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({ error: '竞赛卡片无效' });
        }
        await assertCompetitionAccess(req.user, competitionId);
        await pool.query(
            'DELETE FROM user_class_removals WHERE user_id = ? AND competition_id = ?',
            [req.user.id, competitionId]
        );
        return res.json({ success: true });
    } catch (error) {
        console.error('[SSO] 恢复班级失败：', error.message);
        return res.status(error.status || 500).json({ error: error.message || '恢复班级失败' });
    }
});

// Keep the high-risk destructive flow isolated from ordinary launch/account
// routes while sharing the same platform configuration resolver.
attachSsoModuleInitRoutes(router, { resolvePlatformConfig, officialDependencyOverrides });

export default router;
