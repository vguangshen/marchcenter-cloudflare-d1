import express from '../compat/express.js';
import { authMiddleware } from '../middleware/auth.js';
import {
    canManageCompetitionEvents,
    closeCompetitionEvent,
    createCompetitionEvent,
    isCompetitionEventId,
    markTeacherCompetitionEventSeen,
    prepareCompetitionEvent,
    readCompetitionEventCards,
    readManagedCompetitionEvents,
    readTeacherCompetitionEvents,
    searchCompetitionEventTeachers
} from '../services/competitionEvents.js';
import { ROLES } from '../utils/roleAccess.js';

const router = express.Router();
const MAX_TEACHERS = 100;
const MAX_DURATION_HOURS = 168;
const INPUT_FIELDS = new Set(['competitionId', 'title', 'className', 'teacherIds', 'durationHours', 'requestId']);

function requestError(status, message) {
    return Object.assign(new Error(message), { status });
}

function endpoint(fallback, handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            if ([502, 504].includes(error.status) || (error.status >= 400 && error.status < 500)) {
                return res.status(error.status).json({ error: error.message });
            }
            console.error(fallback, error);
            return res.status(500).json({ error: fallback });
        }
    };
}

function positiveId(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function eventId(req) {
    if (!isCompetitionEventId(req.params.id)) throw requestError(404, '竞赛通知不存在或已失效');
    return req.params.id;
}

function parseEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) {
        throw requestError(400, '竞赛配置格式不正确');
    }
    const { competitionId, teacherIds, className, durationHours = 24, title = '', requestId = null } = input;
    if (!positiveId(competitionId)) throw requestError(400, '请选择有效的竞赛卡片');
    if (!Array.isArray(teacherIds) || !teacherIds.length || teacherIds.length > MAX_TEACHERS
        || !teacherIds.every(positiveId) || new Set(teacherIds).size !== teacherIds.length) {
        throw requestError(400, `请选择 1 至 ${MAX_TEACHERS} 个不同的教师账号`);
    }
    if (!positiveId(durationHours) || durationHours > MAX_DURATION_HOURS) {
        throw requestError(400, `开放时长须为 1 至 ${MAX_DURATION_HOURS} 小时`);
    }
    if (typeof title !== 'string' || title.trim().length > 120 || /[\0\r\n]/.test(title)) {
        throw requestError(400, '竞赛名称不能超过 120 个字符且须为单行');
    }
    if (typeof className !== 'string' || !className.trim() || className.trim().length > 60 || /[\0\r\n]/.test(className)) {
        throw requestError(400, '请填写 1 至 60 个字符的班级名称');
    }
    if (requestId !== null && !isCompetitionEventId(requestId)) throw requestError(400, '提交编号格式不正确');
    return { competitionId, teacherIds, durationHours, title: title.trim(), className: className.trim(), requestId };
}

function managerOnly(req, res, next) {
    if (!canManageCompetitionEvents(req.user)) return res.status(403).json({ error: '需要竞赛管理权限' });
    next();
}

function teacherOnly(req, res, next) {
    if (req.user.role !== ROLES.TEACHER) return res.status(403).json({ error: '仅限教师查看受邀竞赛' });
    next();
}

router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
});
router.use(authMiddleware);

router.get('/cards', managerOnly, endpoint('读取竞赛卡片失败', async (req, res) => {
    res.json({ cards: await readCompetitionEventCards() });
}));

router.get('/teachers', managerOnly, endpoint('读取教师账号失败', async (req, res) => {
    const query = (req.query.q ?? '').trim();
    const page = Number(req.query.page ?? 1);
    if (query.length > 120 || query.includes('\0')) throw requestError(400, '教师搜索内容不正确');
    if (!positiveId(page)) throw requestError(400, '教师列表页码不正确');
    res.json(await searchCompetitionEventTeachers(query, page));
}));

router.get('/manage', managerOnly, endpoint('读取已开启竞赛失败', async (req, res) => {
    res.json({ events: await readManagedCompetitionEvents(req.user) });
}));

router.post('/', managerOnly, endpoint('开启竞赛失败', async (req, res) => {
    const event = await createCompetitionEvent(req.user, parseEvent(req.body), req.raw?.signal);
    if (!event) throw requestError(409, '竞赛卡片或教师账号已发生变化，请刷新后重新选择');
    res.status(201).json({ event });
}));

router.post('/:id/prepare', managerOnly, endpoint('准备竞赛班级失败', async (req, res) => {
    const event = await prepareCompetitionEvent(req.user, eventId(req), req.raw?.signal);
    if (!event) throw requestError(404, '竞赛不存在或你没有管理权限');
    res.json({ event });
}));

router.post('/:id/close', managerOnly, endpoint('关闭竞赛失败', async (req, res) => {
    const event = await closeCompetitionEvent(req.user, eventId(req));
    if (!event) throw requestError(404, '竞赛不存在或你没有管理权限');
    res.json({ event });
}));

router.get('/mine', teacherOnly, endpoint('读取竞赛通知失败', async (req, res) => {
    res.json({ events: await readTeacherCompetitionEvents(req.user) });
}));

router.post('/:id/seen', teacherOnly, endpoint('更新竞赛通知失败', async (req, res) => {
    const event = await markTeacherCompetitionEventSeen(req.user, eventId(req));
    if (!event) throw requestError(404, '竞赛通知不存在或已失效');
    res.json({ event });
}));

export default router;
