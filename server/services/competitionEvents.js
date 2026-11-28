import { createHash } from 'node:crypto';
import pool from '../config/db.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { ACCOUNT_CAPABLE_METHODS } from '../utils/competitionMaintenance.js';
import { withD1Lock } from '../utils/d1Lock.js';
import { validateOfficialDirectUrl } from '../utils/officialCompat/officialJumpConfig.js';
import { executePlatformCompetitionEntry, preparePlatformCompetition } from '../utils/platformJumpDispatcher.js';
import { createRequestDeadline } from '../utils/requestDeadline.js';
import { ROLES } from '../utils/roleAccess.js';
import { resolvePlatformConfig } from '../utils/ssoPlatformConfig.js';
import { competitionSsoSelector, readCompetitionSsoProfiles } from './competitionSsoSelection.js';

const BOUND_METHOD = "CASE WHEN json_valid(config.config_data) THEN json_extract(config.config_data, '$.method') END";
const BOUND_CANARY = "CASE WHEN json_valid(config.config_data) THEN json_extract(config.config_data, '$.canaryOnly') END";
const LEGACY_METHOD = `CASE WHEN NULLIF(card.sso_method, '') IS NULL THEN (${BOUND_METHOD}) END`;
const LEGACY_CANARY = `CASE WHEN NULLIF(card.sso_method, '') IS NULL THEN (${BOUND_CANARY}) END`;
const CARD_FIELDS = `card.url, card.sso_method, card.sso_config_id, card.class_type,
    ${BOUND_METHOD} AS bound_sso_method, ${BOUND_CANARY} AS bound_canary_only, config.name AS bound_sso_name,
    ${LEGACY_METHOD} AS fallback_sso_method, ${LEGACY_CANARY} AS fallback_canary_only`;
const CONFIG_JOIN = 'LEFT JOIN sso_configs config ON config.id = card.sso_config_id';
const EVENT_FIELDS = `event.id, event.competition_id, event.card_binding, event.title, event.class_name, event.duration_hours,
    event.created_by, event.created_at, event.opened_at, event.expires_at, event.closed_at, event.preparation_failed_at,
    event.platform_sso_config_id, event.platform_sso_method, event_config.name AS platform_sso_name,
    CASE WHEN json_valid(event_config.config_data) THEN json_extract(event_config.config_data, '$.method') END AS saved_platform_sso_method,
    CASE WHEN json_valid(event_config.config_data) THEN json_extract(event_config.config_data, '$.canaryOnly') END AS platform_sso_canary_only,
    card.title AS card_title, ${CARD_FIELDS}`;
const EVENT_JOINS = `FROM competition_events event JOIN competitions card ON card.id = event.competition_id
    ${CONFIG_JOIN} LEFT JOIN sso_configs event_config ON event_config.id = event.platform_sso_config_id`;
const ACTIVE_EVENT = 'event.closed_at IS NULL AND event.opened_at <= ? AND event.expires_at > ?';
const MANAGER_ROLES = "('admin', 'super_admin')";
const TEACHER_PAGE_SIZE = 30;
const PREPARE_TIMEOUT_MS = 90_000;
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLATFORM_IDENTITY = /^ev[cts][0-9a-f]{22}$/i;
const PREPARATION_STEPS = new Map([
    ['IsGroupExisted', '检查班级'],
    ['AddTrainGroup', '创建班级'],
    ['AddAppraisalGroup', '创建班级'],
    ['AddMegagameGroup', '创建竞赛班级'],
    ['AddGroup', '创建班级'],
    ['IsTeacherExisted', '检查教师账号'],
    ['AddTeacher', '创建教师账号'],
    ['getLoginTeacherName', '创建教师账号'],
    ['IsStuExisted', '检查学生账号'],
    ['AddStudent', '创建学生账号'],
    ['getUserName', '准备班级和学生账号']
]);

export function isCompetitionEventId(value) {
    return typeof value === 'string' && EVENT_ID.test(value);
}

export function hasCompetitionPlatformIdentity({ loginName, className, teacherUserName, studentList }) {
    return [loginName, className, teacherUserName, ...(Array.isArray(studentList) ? studentList : [])]
        .some(name => typeof name === 'string' && PLATFORM_IDENTITY.test(name.normalize('NFKC').trim()));
}

function competitionError(status, message) {
    return Object.assign(new Error(message), { status });
}

function describePreparationFailure(row, error, startedAt) {
    const operation = error?.operationName || error?.details?.operationName;
    const step = PREPARATION_STEPS.get(operation);
    const resultCode = Number.isSafeInteger(error?.details?.resultCode) ? error.details.resultCode : null;
    const code = /^OFFICIAL_[A-Z0-9_]{1,72}$/.test(error?.code || '') ? error.code : null;
    console.warn('[competition-events] preparation failed', {
        eventId: row.id, competitionId: row.competition_id, method: isolatedMethod(row),
        operation: step ? operation : null, resultCode, code, elapsedMs: Date.now() - startedAt
    });
    if (!step) return '平台未能完成竞赛班级或账号准备，可从竞赛记录重试';
    const resultHint = resultCode === null ? '' : `（平台返回码 ${resultCode}）`;
    return `竞赛平台未确认「${step}」成功${resultHint}，可从竞赛记录重试`;
}

function isolatedMethod(card) {
    const method = card.platform_sso_method || card.sso_method || card.fallback_sso_method;
    if (!ACCOUNT_CAPABLE_METHODS.has(method) || card.bound_canary_only === 1) return null;
    try { validateOfficialDirectUrl(card.url); }
    catch { return null; }
    return method;
}

function fingerprint(values) {
    return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function storedCardBinding(card) {
    return fingerprint([card.url, card.sso_method, card.sso_config_id, card.class_type, card.fallback_sso_method, card.fallback_canary_only]);
}

function currentBinding(row) {
    if (!isolatedMethod(row) || row.card_binding !== storedCardBinding(row)) return false;
    return !row.platform_sso_method || (row.platform_sso_method === row.saved_platform_sso_method
        && row.platform_sso_canary_only !== 1);
}

function isolatedIdentity(eventId, teacherId) {
    const suffix = eventId.replaceAll('-', '').slice(0, 22);
    return {
        className: `evc${suffix}`,
        teacherUserName: `evt${suffix}`,
        ...(teacherId == null ? {} : { studentLoginName: `evs${fingerprint([eventId, teacherId]).slice(0, 22)}` })
    };
}

function dateString(value) {
    return value == null ? null : new Date(value).toISOString();
}

function eventStatus(row, now) {
    if (row.closed_at != null) return 'closed';
    if (!row.class_name || !currentBinding(row)) return 'inactive';
    if (row.opened_at == null) return row.preparation_failed_at == null ? 'preparing' : 'failed';
    return row.expires_at <= now ? 'expired' : 'open';
}

function eventDto(row, now) {
    return {
        id: row.id,
        competitionId: row.competition_id,
        cardTitle: row.card_title,
        title: row.title,
        className: row.class_name,
        loginMode: row.class_name ? 'student_sso' : null,
        startedAt: dateString(row.opened_at),
        createdAt: dateString(row.created_at),
        expiresAt: row.opened_at == null ? null : dateString(row.expires_at),
        closedAt: dateString(row.closed_at),
        status: eventStatus(row, now)
    };
}

function teacherEventDto(row, now) {
    return { ...eventDto(row, now), seenAt: dateString(row.seen_at), enteredAt: dateString(row.entered_at) };
}

export function canManageCompetitionEvents(user) {
    return user?.role === ROLES.ADMIN || user?.role === ROLES.SUPER_ADMIN;
}

async function readCompetitionCardCatalog() {
    const [[rows], profiles] = await Promise.all([
        pool.query(`SELECT card.id, card.title, card.category, ${CARD_FIELDS}
            FROM competitions card ${CONFIG_JOIN} ORDER BY card.title COLLATE NOCASE, card.id`),
        readCompetitionSsoProfiles()
    ]);
    return { rows, profiles };
}

export async function readCompetitionEventCards(user) {
    const { rows, profiles } = await readCompetitionCardCatalog();
    const select = competitionSsoSelector(user, profiles, rows);
    return rows.flatMap(row => {
        const ssoSelection = select(row);
        return ssoSelection
            ? [{ id: row.id, title: row.title, category: row.category, loginMode: 'student_sso', ssoSelection }]
            : [];
    });
}

export async function searchCompetitionEventTeachers(query, requestedPage) {
    const filter = "role = 'teacher' AND is_disabled = 0 AND instr(lower(username), lower(?)) > 0";
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users WHERE ${filter}`, [query]);
    const totalPages = Math.max(1, Math.ceil(total / TEACHER_PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const [teachers] = await pool.query(`
        SELECT id, username FROM users WHERE ${filter}
        ORDER BY username COLLATE NOCASE, id LIMIT ? OFFSET ?`,
        [query, TEACHER_PAGE_SIZE, (page - 1) * TEACHER_PAGE_SIZE]);
    return { teachers, total, page, totalPages };
}

export async function readManagedCompetitionEvents(user, { eventId, now = Date.now() } = {}) {
    const [rows] = await pool.query(`
        SELECT ${EVENT_FIELDS},
            (SELECT json_group_array(name) FROM (
                SELECT teacher.username AS name
                FROM competition_event_teachers recipient JOIN users teacher ON teacher.id = recipient.teacher_id
                WHERE recipient.event_id = event.id AND teacher.role = 'teacher' AND teacher.is_disabled = 0
                ORDER BY teacher.username COLLATE NOCASE, teacher.id
            )) AS teachers
        ${EVENT_JOINS}
        WHERE (? OR event.created_by = ?) AND (? IS NULL OR event.id = ?)
        ORDER BY (COALESCE((${ACTIVE_EVENT}), 0)) DESC, event.created_at DESC, event.id DESC LIMIT 100`,
        [user.role === ROLES.SUPER_ADMIN, user.id, eventId ?? null, eventId ?? null, now, now]);
    return rows.map(row => {
        const event = eventDto(row, now);
        const teacherNames = JSON.parse(row.teachers);
        const identity = event.className ? isolatedIdentity(event.id) : null;
        return {
            ...event,
            teacherCount: teacherNames.length,
            teacherNames,
            platformClassName: identity?.className ?? null,
            teacherAccountName: identity?.teacherUserName ?? null,
            ssoConfiguration: row.platform_sso_name ? {
                id: row.platform_sso_config_id, name: row.platform_sso_name, method: row.platform_sso_method
            } : !row.platform_sso_config_id && row.bound_sso_name && row.bound_sso_method === isolatedMethod(row) ? {
                id: row.sso_config_id, name: row.bound_sso_name, method: row.bound_sso_method
            } : null,
            canEnterTeacher: event.status === 'open' && row.created_by === user.id,
            canRetry: event.status === 'failed' || event.status === 'preparing'
        };
    });
}

export async function readTeacherCompetitionEvents(user, now = Date.now()) {
    const [rows] = await pool.query(`
        SELECT ${EVENT_FIELDS}, recipient.seen_at, recipient.entered_at
        ${EVENT_JOINS}
        JOIN competition_event_teachers recipient ON recipient.event_id = event.id
        JOIN users teacher ON teacher.id = recipient.teacher_id AND teacher.role = 'teacher' AND teacher.is_disabled = 0
        WHERE recipient.teacher_id = ? AND ${ACTIVE_EVENT}
        ORDER BY (recipient.seen_at IS NULL) DESC, event.opened_at DESC, event.id DESC LIMIT 100`,
        [user.id, now, now]);
    return rows.map(row => teacherEventDto(row, now)).filter(event => event.status === 'open');
}

async function readEntry(user, eventId, competitionId, now = Date.now()) {
    const [[row]] = await pool.query(`
        SELECT ${EVENT_FIELDS}, recipient.seen_at, recipient.entered_at,
            CASE WHEN actor.role = 'teacher' THEN 'student' ELSE 'teacher' END AS entry_role
        ${EVENT_JOINS}
        JOIN users actor ON actor.id = ? AND actor.role = ? AND actor.is_disabled = 0
        LEFT JOIN competition_event_teachers recipient ON recipient.event_id = event.id AND recipient.teacher_id = actor.id
        WHERE event.id = ? AND (? IS NULL OR event.competition_id = ?) AND ${ACTIVE_EVENT}
          AND ((actor.role = 'teacher' AND recipient.teacher_id IS NOT NULL)
                OR (actor.role IN ${MANAGER_ROLES} AND event.created_by = actor.id))`,
        [user.id, user.role, eventId, competitionId, competitionId, now, now]);
    return row && eventStatus(row, now) === 'open' ? row : null;
}

async function markStudentEntry(user, eventId, now, entered) {
    const [result] = await pool.query(`
        UPDATE competition_event_teachers
        SET seen_at = COALESCE(seen_at, ?), entered_at = CASE WHEN ? THEN COALESCE(entered_at, ?) ELSE entered_at END
        WHERE event_id = ? AND teacher_id = ?
          AND EXISTS (SELECT 1 FROM competition_events event WHERE event.id = ? AND ${ACTIVE_EVENT})
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'teacher' AND is_disabled = 0)`,
        [now, entered, now, eventId, user.id, eventId, now, now, user.id]);
    return Boolean(result.affectedRows);
}

export async function markTeacherCompetitionEventSeen(user, eventId) {
    if (!await readEntry(user, eventId, null)) return null;
    if (!await markStudentEntry(user, eventId, Date.now(), false)) return null;
    const row = await readEntry(user, eventId, null);
    return row ? teacherEventDto(row, Date.now()) : null;
}

async function resolveEventConfig(row, context) {
    const method = isolatedMethod(row);
    const configId = row.platform_sso_config_id ?? row.sso_config_id;
    const { effectiveConfig } = await resolvePlatformConfig({
        configId, method, classType: row.class_type
    }, context, { preferBoundConfig: true });
    if (effectiveConfig.method !== method) {
        throw competitionError(409, '竞赛卡片配置已更新，请重新开启竞赛');
    }
    return effectiveConfig;
}

function eventContext(row, role, startTime, endTime, user) {
    const identity = isolatedIdentity(row.id, role === 'student' ? user.id : null);
    return {
        cardUrl: row.url,
        loginRole: role,
        loginName: role === 'teacher' ? identity.teacherUserName : identity.studentLoginName,
        className: identity.className,
        teacherUserName: identity.teacherUserName,
        startTime,
        endTime,
        startExam: false,
        studentList: [],
        ...(user ? { user, userName: user.username } : {})
    };
}

export async function launchCompetitionEvent(user, eventId, competitionId, { onStage, signal } = {}) {
    if (!isCompetitionEventId(eventId) || !Number.isSafeInteger(competitionId) || competitionId < 1) {
        throw competitionError(400, '竞赛入口参数无效');
    }
    const event = await readEntry(user, eventId, competitionId);
    if (!event) throw competitionError(404, '竞赛入口不存在或已关闭');
    const open = async () => {
        const row = await readEntry(user, eventId, competitionId);
        if (!row) throw competitionError(409, '竞赛入口已关闭或过期');
        await assertCompetitionAccess(user, competitionId, { assignedStudentEntry: row.entry_role === 'student' });
        const context = {
            ...eventContext(row, row.entry_role, row.opened_at, row.expires_at, user),
            onStage,
            accountWasReady: row.entry_role === 'teacher' || isolatedMethod(row) !== 'java'
        };
        const effectiveConfig = await resolveEventConfig(row, context);
        const redirectUrl = await executePlatformCompetitionEntry(effectiveConfig, context, { official: { signal } });
        signal?.throwIfAborted();
        if (row.entry_role === 'student' && !await markStudentEntry(user, eventId, Date.now(), true)) {
            throw competitionError(409, '竞赛入口已关闭或过期');
        }
        if (!await readEntry(user, eventId, competitionId)) {
            throw competitionError(409, '竞赛入口已关闭或过期');
        }
        return { success: true, redirectUrl, postForm: null, adapter: effectiveConfig.method };
    };
    return event.entry_role === 'student' && isolatedMethod(event) === 'java'
        ? withD1Lock(`mc-event-student:${eventId}:${user.id}`, open, { signal, waitMs: 10_000, leaseMs: 180_000 })
        : open();
}

async function readManagedEventRow(user, eventId) {
    const [[row]] = await pool.query(`
        SELECT ${EVENT_FIELDS} ${EVENT_JOINS}
        JOIN users actor ON actor.id = ? AND actor.role = ? AND actor.is_disabled = 0
        WHERE event.id = ? AND actor.role IN ${MANAGER_ROLES}
          AND (actor.role = 'super_admin' OR event.created_by = actor.id)`, [user.id, user.role, eventId]);
    return row;
}

export async function prepareCompetitionEvent(user, eventId, requestSignal) {
    const deadline = createRequestDeadline(PREPARE_TIMEOUT_MS, requestSignal,
        competitionError(504, '平台准备超时，可从竞赛记录重试'));
    try {
        return await withD1Lock(`mc-event-prepare:${eventId}`, async () => {
            const row = await readManagedEventRow(user, eventId);
            if (!row) return null;
            if (row.opened_at != null || row.closed_at != null) {
                return (await readManagedCompetitionEvents(user, { eventId }))[0];
            }
            if (!row.class_name || !currentBinding(row)) {
                throw competitionError(409, '竞赛卡片配置已更新，请重新开启竞赛');
            }
            const [recipients] = await pool.query(`
                SELECT teacher.id FROM competition_event_teachers recipient
                JOIN users teacher ON teacher.id = recipient.teacher_id AND teacher.role = 'teacher' AND teacher.is_disabled = 0
                WHERE recipient.event_id = ? ORDER BY teacher.id`, [eventId]);
            const now = Date.now();
            const expiresAt = now + row.duration_hours * 3_600_000;
            const context = {
                ...eventContext(row, 'teacher', now, expiresAt),
                userId: row.created_by,
                studentList: recipients.map(recipient => isolatedIdentity(eventId, recipient.id).studentLoginName)
            };
            try {
                if (!recipients.length) throw competitionError(409, '目前没有可用的受邀教师账号');
                const effectiveConfig = await resolveEventConfig(row, context);
                deadline.signal.throwIfAborted();
                await preparePlatformCompetition(effectiveConfig, context, { official: { signal: deadline.signal } });
                deadline.signal.throwIfAborted();
                const latest = await readManagedEventRow(user, eventId);
                if (!latest || latest.closed_at != null || !currentBinding(latest)) {
                    throw competitionError(409, '竞赛或卡片已更新，请重新查看竞赛记录');
                }
                const [updated] = await pool.query(`
                    UPDATE competition_events SET opened_at = ?, expires_at = ?, preparation_failed_at = NULL
                    WHERE id = ? AND closed_at IS NULL AND opened_at IS NULL AND card_binding = ?
                      AND EXISTS (
                        SELECT 1 FROM competition_event_teachers recipient
                        JOIN users teacher ON teacher.id = recipient.teacher_id AND teacher.role = 'teacher' AND teacher.is_disabled = 0
                        WHERE recipient.event_id = competition_events.id
                      )`, [now, expiresAt, eventId, row.card_binding]);
                if (!updated.affectedRows) throw competitionError(409, '竞赛名单或状态已更新，请重新查看竞赛记录');
            } catch (error) {
                const failure = describePreparationFailure(row, error, now);
                await pool.query(`UPDATE competition_events SET preparation_failed_at = ?
                    WHERE id = ? AND opened_at IS NULL AND closed_at IS NULL`, [Date.now(), eventId]);
                if (deadline.signal.aborted && deadline.signal.reason?.status === 504) throw deadline.signal.reason;
                if ([400, 403, 409, 504].includes(error?.status)) throw error;
                throw competitionError(502, failure);
            }
            return (await readManagedCompetitionEvents(user, { eventId }))[0];
        }, { waitMs: 5_000, leaseMs: 120_000, signal: deadline.signal });
    } finally {
        deadline.dispose();
    }
}

async function readMatchingRequest(user, requestId, expectedFingerprint) {
    if (!requestId) return null;
    const [[previous]] = await pool.query('SELECT id, request_fingerprint FROM competition_events WHERE created_by = ? AND request_id = ?', [user.id, requestId]);
    if (previous && previous.request_fingerprint !== expectedFingerprint) {
        throw competitionError(409, '这次提交的竞赛配置已改变，请重新发起');
    }
    return previous?.id ?? null;
}

export async function createCompetitionEvent(user, input, requestSignal) {
    const teacherIds = JSON.stringify([...input.teacherIds].sort((a, b) => a - b));
    const requestFields = [input.competitionId, input.title, input.className, input.durationHours, teacherIds];
    if (input.ssoConfigId != null) requestFields.push(input.ssoConfigId);
    const requestFingerprint = fingerprint(requestFields);
    const previous = await readMatchingRequest(user, input.requestId, requestFingerprint);
    if (previous) return prepareCompetitionEvent(user, previous, requestSignal);

    const [{ rows, profiles }, [[{ eligible }]]] = await Promise.all([
        readCompetitionCardCatalog(),
        pool.query(`SELECT COUNT(*) AS eligible FROM json_each(?) requested JOIN users teacher ON teacher.id = requested.value
                    WHERE teacher.role = 'teacher' AND teacher.is_disabled = 0`, [teacherIds])
    ]);
    const card = rows.find(row => row.id === input.competitionId);
    if (!card) throw competitionError(404, '竞赛卡片不存在');
    if (eligible !== input.teacherIds.length) throw competitionError(400, '只能选择未被禁用的教师账号');
    const selection = competitionSsoSelector(user, profiles, rows)(card);
    if (!selection) throw competitionError(400, '该卡片没有可用于建班的免密配置，请在系统设置中检查卡片绑定');
    const selectedProfile = selection.mode === 'auto'
        ? (input.ssoConfigId == null || selection.profile.id === input.ssoConfigId ? selection.profile : null)
        : selection.profiles.find(profile => profile.id === input.ssoConfigId);
    if (!selectedProfile) throw competitionError(400, '请选择该卡片可用的系统免密配置');

    const eventId = crypto.randomUUID();
    const now = Date.now();
    const [event] = await pool.batch([
        [
            `INSERT INTO competition_events (id, competition_id, card_binding, title, class_name, duration_hours,
                 platform_sso_config_id, platform_sso_method,
                 created_by, request_id, request_fingerprint, created_at, expires_at)
             SELECT ?, card.id, ?, COALESCE(NULLIF(?, ''), NULLIF(substr(trim(card.title), 1, 120), ''), '竞赛'),
                 ?, ?, ?, ?, actor.id, ?, ?, ?, ?
             FROM competitions card ${CONFIG_JOIN} JOIN users actor ON actor.id = ?
             WHERE card.id = ? AND card.url = ? AND card.sso_method IS ? AND card.sso_config_id IS ? AND card.class_type IS ?
               AND (${LEGACY_METHOD}) IS ? AND (${LEGACY_CANARY}) IS ?
               AND actor.role = ? AND actor.role IN ${MANAGER_ROLES} AND actor.is_disabled = 0
               AND EXISTS (
                   SELECT 1 FROM sso_configs selected
                   WHERE selected.id = ? AND CASE WHEN json_valid(selected.config_data)
                       THEN json_extract(selected.config_data, '$.method') = ?
                           AND json_extract(selected.config_data, '$.canaryOnly') IS NOT 1 ELSE 0 END
               )
               AND (SELECT COUNT(*) FROM json_each(?) requested JOIN users teacher ON teacher.id = requested.value
                    WHERE teacher.role = 'teacher' AND teacher.is_disabled = 0) = ?
             ON CONFLICT(created_by, request_id) DO NOTHING`,
            [eventId, storedCardBinding(card), input.title, input.className, input.durationHours,
                selectedProfile.id, selectedProfile.method, input.requestId,
                requestFingerprint, now, now + input.durationHours * 3_600_000, user.id, input.competitionId,
                card.url, card.sso_method, card.sso_config_id, card.class_type, card.fallback_sso_method, card.fallback_canary_only,
                user.role, selectedProfile.id, selectedProfile.method, teacherIds, input.teacherIds.length]
        ],
        [
            `INSERT INTO competition_event_teachers (event_id, teacher_id)
             SELECT event.id, requested.value FROM competition_events event CROSS JOIN json_each(?) requested
             WHERE event.id = ?`,
            [teacherIds, eventId]
        ]
    ]);
    const savedEventId = event.affectedRows ? eventId : await readMatchingRequest(user, input.requestId, requestFingerprint);
    return savedEventId ? prepareCompetitionEvent(user, savedEventId, requestSignal) : null;
}

export async function closeCompetitionEvent(user, eventId, now = Date.now()) {
    const [result] = await pool.query(`
        UPDATE competition_events SET closed_at = COALESCE(closed_at, ?),
            closed_by = CASE WHEN closed_at IS NULL THEN ? ELSE closed_by END
        WHERE id = ? AND (? OR created_by = ?)
          AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = ? AND role IN ${MANAGER_ROLES} AND is_disabled = 0)`,
        [now, user.id, eventId, user.role === ROLES.SUPER_ADMIN, user.id, user.id, user.role]);
    if (!result.affectedRows) return null;
    return (await readManagedCompetitionEvents(user, { eventId, now }))[0];
}
