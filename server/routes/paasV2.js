import crypto from 'crypto';
import express from '../compat/express.js';
import pool from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getRuntime } from '../config/runtime.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { decodeStoredConfig } from '../utils/configSecrets.js';
import { createOfficialSafeFetch } from '../utils/officialCompat/safeTransport.js';
import { createPaasV2Adapter } from '../utils/officialCompat/paasV2/paasV2Adapter.js';

const router = express.Router();

const SOFTWARE_UNIQUE_OPTIONS = Object.freeze([
    { id: 'PT0401', softwareUnique: 'KJDZSWRJXT', name: '跨境电子商务人机协同产教融合平台' },
    { id: 'PT0402', softwareUnique: 'scyxcjrh', name: '市场营销人机协同通用能力平台' },
    { id: 'PT0403', softwareUnique: 'kjrjxt09', name: '财经人机协同产教融合平台' },
    { id: 'PT0404', softwareUnique: 'dzswcjrh', name: '电子商务人机协同产教融合平台' }
]);

const SYNC_ENDPOINT = 'http://paas.itmc.org.cn/paascode/synchronize/getSoftwareInfoToJson';
const DAYU_LOGIN_ENDPOINT = 'https://dayu.itmc.org.cn/prod-api/auth/login';
const DAYU_HOT_INDEX_ENDPOINT = 'https://dayu.itmc.org.cn/prod-api/agent/explore/getHotIndex';
const DAYU_COVER_ADMIN_USERNAME = 'admin';
const DAYU_COVER_ADMIN_PASSWORD = 'ITMC@123abc..';
const COVER_R2_PREFIX = 'paas-v2-covers/';
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const CACHE_COVER_TIMEOUT_MS = 20000;

function asSoftwareUnique(value) {
    return String(value || '').trim();
}

function isValidSoftwareUnique(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function normalizeName(value) {
    return String(value || '').toLowerCase().replace(/[\s·\-_.:：()（）]/g, '');
}

function coverExtension(url) {
    try {
        const path = new URL(url).pathname;
        const match = path.match(/\.(png|jpe?g|webp|gif|avif)$/i);
        return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
    } catch { return 'png'; }
}

function coverKey(url, ext) {
    return `${crypto.createHash('md5').update(url).digest('hex')}.${ext}`;
}

function sniffImageContentType(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
    return '';
}

async function cacheCover(coverUrl, timeoutMs = CACHE_COVER_TIMEOUT_MS) {
    if (!coverUrl) return '';
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const cached = await cacheCoverOnce(coverUrl, timeoutMs);
        if (cached && cached !== coverUrl) return cached;
    }
    return coverUrl;
}

async function cacheCoverOnce(coverUrl, timeoutMs) {
    try {
        const referer = (() => {
            try { const parsed = new URL(coverUrl); return `${parsed.protocol}//${parsed.host}/`; }
            catch { return 'https://resource.zuoyizuo.com/'; }
        })();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const origin = referer.endsWith('/') ? referer.slice(0, -1) : referer;
            const response = await fetch(coverUrl, {
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    'Referer': referer,
                    'Origin': origin
                },
                signal: controller.signal
            });
            if (!response.ok) return coverUrl;
            const ext = coverExtension(coverUrl);
            const buffer = await response.arrayBuffer();
            if (!buffer || buffer.byteLength > MAX_COVER_BYTES) return coverUrl;
            const sniffed = sniffImageContentType(buffer);
            const headerType = response.headers.get('content-type') || '';
            let contentType = sniffed;
            if (!contentType && headerType.toLowerCase().startsWith('image/')) contentType = headerType;
            if (!contentType) return coverUrl;
            const key = `${COVER_R2_PREFIX}${coverKey(coverUrl, ext)}`;
            const bucket = getRuntime().env.WALLPAPERS;
            if (!bucket) return coverUrl;
            await bucket.put(key, buffer, {
                httpMetadata: { contentType }
            });
            return `/api/paas-v2/covers/${coverKey(coverUrl, ext)}`;
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return coverUrl;
    }
}

async function searchDayuCover(keyword, token) {
    if (!keyword || !token) return { cover: '', introduce: '' };
    try {
        const response = await fetch(DAYU_HOT_INDEX_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                page: 0,
                size: 5,
                keyword,
                type: 2,
                hotListCondition: 'releaseTime',
                sortBy: 'score:desc',
                score: 0,
                positions: ''
            }),
            redirect: 'manual'
        });
        if (!response.ok) return { cover: '', introduce: '' };
        const payload = await response.json();
        const items = payload?.data?.content || [];
        const first = items[0] || {};
        return { cover: first.cover || '', introduce: first.introduce || '' };
    } catch {
        return { cover: '', introduce: '' };
    }
}

async function fetchDayuCoverMap() {
    try {
        const loginResponse = await fetch(DAYU_LOGIN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: DAYU_COVER_ADMIN_USERNAME,
                password: DAYU_COVER_ADMIN_PASSWORD
            }),
            redirect: 'manual'
        });
        if (!loginResponse.ok) return new Map();
        const loginJson = await loginResponse.json();
        const token = loginJson?.data?.access_token;
        if (!token) return new Map();

        const hotResponse = await fetch(DAYU_HOT_INDEX_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                page: 0,
                size: 9999,
                keyword: '',
                type: 2,
                hotListCondition: 'releaseTime',
                sortBy: 'score:desc',
                score: 0,
                positions: ''
            }),
            redirect: 'manual'
        });
        if (!hotResponse.ok) return new Map();
        const hotJson = await hotResponse.json();
        const items = hotJson?.data?.content || [];
        const byId = new Map();
        const byName = new Map();
        for (const item of items) {
            if (item.id && !byId.has(String(item.id))) {
                byId.set(String(item.id), { cover: item.cover || '', introduce: item.introduce || '' });
            }
            const name = normalizeName(item.name);
            if (name && !byName.has(name)) byName.set(name, { cover: item.cover || '', introduce: item.introduce || '' });
        }
        return { byId, byName, token };
    } catch {
        return { byId: new Map(), byName: new Map(), token: '' };
    }
}

function matchIntroduce(title, plugName, infoMap) {
    const candidates = [title, plugName].filter(Boolean);
    for (const candidate of candidates) {
        const normalized = normalizeName(candidate);
        if (infoMap.has(normalized)) return infoMap.get(normalized).introduce || '';
    }
    for (const candidate of candidates) {
        const normalized = normalizeName(candidate);
        for (const [name, info] of infoMap.entries()) {
            if (name && normalized && (name.includes(normalized) || normalized.includes(name))) return info.introduce || '';
        }
    }
    return '';
}

function matchCover(title, plugName, coverMap) {
    const candidates = [title, plugName].filter(Boolean);
    for (const candidate of candidates) {
        const normalized = normalizeName(candidate);
        if (coverMap.has(normalized)) return coverMap.get(normalized).cover || '';
    }
    for (const candidate of candidates) {
        const normalized = normalizeName(candidate);
        for (const [name, info] of coverMap.entries()) {
            if (name && normalized && (name.includes(normalized) || normalized.includes(name))) {
                return info.cover || '';
            }
        }
    }
    return '';
}

function toTaskRows(data) {
    const taskJson = Array.isArray(data.taskJson) ? data.taskJson : [];
    const plugMngJson = Array.isArray(data.plugMngJson) ? data.plugMngJson : [];
    const taskEnterInfoJson = Array.isArray(data.taskEnterInfoJson) ? data.taskEnterInfoJson : [];
    const plugByName = new Map(plugMngJson.map(item => [String(item.plugFlag), item]));
    const taskByPlugFlag = new Map(taskJson.map(item => [String(item.plugId || item.plugFlag), item]));
    const appByPlugFlag = new Map(taskEnterInfoJson.map(item => [String(item.plugFlag), item]));
    const keys = [...new Set([...taskByPlugFlag.keys(), ...plugByName.keys(), ...appByPlugFlag.keys()])];
    return keys.map(plugFlag => {
        const plug = plugByName.get(plugFlag) || {};
        const task = taskByPlugFlag.get(plugFlag) || {};
        const app = appByPlugFlag.get(plugFlag) || {};
        return {
            plugFlag,
            title: task.taskTitle || plug.plugName || plugFlag,
            plugName: plug.plugName || '',
            answerType: app.answerType || '1,2,3,4',
            trainType: app.trainType ?? null,
            appType: app.appType ?? null,
            trainPath: app.trainPath || '',
            trainJumpPath: app.trainJumpPath || '',
            moduleId: task.taskModuleId || plug.taskModuleId || null
        };
    }).sort((left, right) => String(left.title).localeCompare(String(right.title), 'zh-CN'));
}

router.get('/options', authMiddleware, adminOnly, async (_req, res) => {
    res.json(SOFTWARE_UNIQUE_OPTIONS);
});

router.get('/catalog', authMiddleware, adminOnly, async (req, res) => {
    const softwareUnique = asSoftwareUnique(req.query.softwareUnique);
    if (!isValidSoftwareUnique(softwareUnique)) {
        return res.status(400).json({ error: 'softwareUnique 格式无效，仅支持字母、数字、点、下划线和中划线' });
    }
    const platformCode = asSoftwareUnique(req.query.platformCode);
    const platformName = String(req.query.platformName || '').trim();
    const option = SOFTWARE_UNIQUE_OPTIONS.find(item => item.softwareUnique === softwareUnique);
    const resolvedPlatformName = platformName || option?.name || softwareUnique;
    const resolvedPlatformCode = platformCode || option?.id || '';
    try {
        const response = await fetch(SYNC_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `token=${encodeURIComponent(softwareUnique)}`,
            redirect: 'manual'
        });
        if (!response.ok) {
            return res.status(502).json({ error: `任务目录请求失败：HTTP ${response.status}` });
        }
        const raw = await response.text();
        let payload;
        try { payload = JSON.parse(raw); } catch {
            return res.status(502).json({ error: '任务目录返回格式无效' });
        }
        if (String(payload.code) !== '0') {
            return res.status(502).json({ error: payload.msg || '任务目录返回异常' });
        }
        if (!payload.data) {
            return res.status(502).json({ error: '未找到该 softwareUnique 对应的软件任务目录' });
        }
        const coverIndex = await fetchDayuCoverMap();
        const rows = toTaskRows(payload.data);
        const tasks = [];
        for (const task of rows) {
            const idHit = coverIndex.byId.get(String(task.plugFlag));
            let cover = idHit?.cover || matchCover(task.title, task.plugName, coverIndex.byName);
            let introduce = idHit?.introduce || matchIntroduce(task.title, task.plugName, coverIndex.byName);
            if (!cover || !introduce) {
                const searched = await searchDayuCover(task.title, coverIndex.token);
                if (!cover) cover = searched.cover;
                if (!introduce) introduce = searched.introduce;
            }
            tasks.push({ ...task, cover, introduce });
        }
        return res.json({
            softwareUnique,
            platformCode: resolvedPlatformCode,
            platformName: resolvedPlatformName,
            tasks
        });
    } catch (error) {
        console.error('[paas-v2-catalog]', error.message);
        return res.status(502).json({ error: error.message || '任务目录获取失败' });
    }
});

router.post('/reset', authMiddleware, async (req, res) => {
    const competitionId = Number(req.body?.competitionId);
    if (!Number.isInteger(competitionId) || competitionId <= 0) {
        return res.status(400).json({ error: '竞赛卡片编号无效' });
    }
    try {
        await assertCompetitionAccess(req.user, competitionId);
        const [[card]] = await pool.query(
            `SELECT id, url, sso_config_id AS ssoConfigId, sso_method AS ssoMethod,
                    paas_v2_plug_flag AS plugFlag, paas_v2_answer_type AS answerType,
                    paas_v2_software_unique AS softwareUnique
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!card || card.ssoMethod !== 'paasV2') {
            return res.status(400).json({ error: '该卡片不是智能体任务' });
        }
        const [[sso]] = await pool.query('SELECT config_data FROM sso_configs WHERE id = ?', [card.ssoConfigId]);
        if (!sso) return res.status(409).json({ error: '该智能体任务尚未绑定免密配置' });
        const config = decodeStoredConfig(sso.config_data || {});
        config.plugFlag = card.plugFlag || config.plugFlag;
        config.answerType = card.answerType || config.answerType;
        config.softwareUnique = card.softwareUnique || config.softwareUnique;
        const baseUrl = config.apiBaseUrl || config.officialBaseUrl || '';
        if (!baseUrl) return res.status(409).json({ error: '该智能体任务缺少 apiBaseUrl' });
        const fetchImplementation = createOfficialSafeFetch({
            baseUrl,
            allowHttp: config.allowHttp === true
        });
        const adapter = createPaasV2Adapter({ config, fetchImplementation });
        await adapter.resetTaskData({
            loginRole: 'student',
            loginName: `mcs${req.user.username}1`,
            teacherUserName: `mc${req.user.username}`,
            className: `mc${req.user.username}`,
            userName: req.user.name || req.user.username,
            currentLoginName: req.user.username,
            userId: req.user.id,
            plugFlag: config.plugFlag,
            answerType: config.answerType,
            softwareUnique: config.softwareUnique
        });
        await pool.query(
            'DELETE FROM user_workflow_status WHERE user_id = ? AND competition_id = ?',
            [req.user.id, competitionId]
        );
        return res.json({ success: true });
    } catch (error) {
        console.error('[paas-v2-reset]', error, error?.cause);
        return res.status(error.status || 500).json({ error: error.message || '重置智能体任务失败' });
    }
});

async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

router.post('/covers/cache', authMiddleware, adminOnly, async (req, res) => {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls.map(value => String(value || '').trim()).filter(Boolean) : [];
    if (!urls.length) return res.status(400).json({ error: '请提供需要缓存的封面地址' });
    try {
        const entries = await runWithConcurrency(urls, 4, async url => [url, await cacheCover(url)]);
        const result = Object.fromEntries(entries);
        const failed = urls.filter(url => result[url] === url);
        if (failed.length) {
            console.warn(`[paas-v2-cover-cache] retrying ${failed.length} failed covers`);
            const retried = await runWithConcurrency(failed, 2, async url => [url, await cacheCover(url, 30000)]);
            for (const [url, value] of retried) {
                if (value && value !== url) result[url] = value;
            }
        }
        return res.json({ covers: result });
    } catch (error) {
        console.error('[paas-v2-cover-cache]', error.message);
        return res.status(502).json({ error: error.message || '封面缓存失败' });
    }
});

router.get('/covers/:key', async (req, res) => {
    const key = String(req.params.key || '');
    if (!/^[a-f0-9]{32}\.(?:png|jpg|jpeg|webp|gif|avif)$/i.test(key)) {
        return res.status(400).json({ error: '封面编号无效' });
    }
    try {
        const bucket = getRuntime().env.WALLPAPERS;
        if (!bucket) return res.status(503).json({ error: '封面存储不可用' });
        const object = await bucket.get(`${COVER_R2_PREFIX}${key}`);
        if (!object) return res.status(404).json({ error: '封面不存在' });
        const body = await object.arrayBuffer();
        res.setHeader('Content-Type', object.httpMetadata?.contentType || 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(Buffer.from(body));
    } catch (error) {
        console.error('[paas-v2-cover]', error.message);
        return res.status(502).json({ error: error.message || '封面读取失败' });
    }
});

export default router;
