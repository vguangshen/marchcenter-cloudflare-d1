import crypto from 'crypto';
import express from '../compat/express.js';
import pool from '../config/db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { getEnv, getRuntime } from '../config/runtime.js';
import { assertCompetitionAccess } from '../utils/accessControl.js';
import { decodeStoredConfig } from '../utils/configSecrets.js';
import { withD1Lock } from '../utils/d1Lock.js';
import { mapCardAddressToOfficialConfig, validateOfficialTransportAddress } from '../utils/officialCompat/cardAddress.js';
import { mapMarchCenterToOfficialParameters, selectOfficialBaseUrl } from '../utils/officialCompat/officialJumpConfig.js';
import { createOfficialSafeFetch } from '../utils/officialCompat/safeTransport.js';
import { createPaasV2Adapter, PAAS_V2_ANSWER_TYPE } from '../utils/officialCompat/paasV2/paasV2Adapter.js';
import { deletePlatformAndTasks, findPlatform, listPlatforms, normalizePlatformInput, parseSavedCatalog, platformKey } from '../utils/paasV2Platforms.js';
import { parseCatalogPayload, toTaskRows } from '../utils/paasV2Catalog.js';
import { MAX_COVER_BYTES, readLimitedCover, waitForCoverOperation } from '../utils/coverDownload.js';
import { createRequestDeadline as deadlineSignal } from '../utils/requestDeadline.js';

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
const COVER_R2_PREFIX = 'paas-v2-covers/';
const CACHE_COVER_TIMEOUT_MS = 20000;
const MAX_COVER_BATCH_SIZE = 100;
const COVER_BATCH_TIMEOUT_MS = 90000;
const TRANSIENT_COVER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const CACHED_COVER_PATH = /^\/api\/paas-v2\/covers\/[a-f0-9]{32}\.(?:png|jpe?g|webp|gif|avif)$/i;

function coverEnhancementTimeout() {
    const configured = Number(getEnv('DAYU_COVER_TIMEOUT_MS', 5000));
    return Number.isFinite(configured) ? Math.max(50, Math.min(10000, configured)) : 5000;
}

const emptyCoverIndex = () => ({ byId: new Map(), byName: new Map(), token: '' });

function isPrivateCoverHost(value) {
    const host = String(value || '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost')
        || host.endsWith('.local') || host.endsWith('.internal')) return true;
    const privateIpv4 = parts => {
        const [a, b] = parts;
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 198 && [18, 19].includes(b));
    };
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return privateIpv4(host.split('.').map(Number));
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(host);
    if (mapped) {
        const high = parseInt(mapped[1], 16);
        const low = parseInt(mapped[2], 16);
        return privateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
    }
    return host.includes(':') && (host === '::' || host === '::1' || /^(?:f[cd]|fe[89ab]|ff)/.test(host));
}

function validateCoverCacheUrl(value) {
    if (CACHED_COVER_PATH.test(value)) return;
    let url;
    try { url = new URL(value); } catch { /* Report the same client contract for malformed URLs. */ }
    if (value.length > 4096 || !url || !['https:', 'http:'].includes(url.protocol)
        || url.username || url.password || isPrivateCoverHost(url.hostname)) {
        throw Object.assign(new Error('封面地址不允许缓存，请使用公共 HTTP 或 HTTPS 图片地址'), {
            status: 400, code: 'cover_url_not_allowed'
        });
    }
}

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

async function cacheCover(coverUrl, signal) {
    if (!coverUrl) return '';
    if (CACHED_COVER_PATH.test(coverUrl)) return coverUrl;
    if (signal?.aborted) return coverUrl;
    const bucket = getRuntime().env.WALLPAPERS;
    if (!bucket) return coverUrl;
    const key = `${COVER_R2_PREFIX}${coverKey(coverUrl, coverExtension(coverUrl))}`;
    try {
        const stored = await waitForCoverOperation(() => bucket.head(key), signal);
        if (stored && stored.size > 0 && stored.size <= MAX_COVER_BYTES) return `/api/paas-v2/covers/${coverKey(coverUrl, coverExtension(coverUrl))}`;
    } catch { return coverUrl; }
    for (let attempt = 0; attempt < 2 && !signal?.aborted; attempt += 1) {
        const result = await cacheCoverOnce(coverUrl, bucket, key, signal);
        if (result.cachedUrl) return result.cachedUrl;
        if (!result.retryable) break;
    }
    return coverUrl;
}

async function cacheCoverOnce(coverUrl, bucket, key, externalSignal) {
    const deadline = deadlineSignal(CACHE_COVER_TIMEOUT_MS, externalSignal);
    try {
        const referer = (() => {
            try { const parsed = new URL(coverUrl); return `${parsed.protocol}//${parsed.host}/`; }
            catch { return 'https://resource.zuoyizuo.com/'; }
        })();
        const origin = referer.endsWith('/') ? referer.slice(0, -1) : referer;
        const response = await fetch(coverUrl, {
            redirect: 'manual',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': referer,
                'Origin': origin
            },
            signal: deadline.signal
        });
        if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return { retryable: TRANSIENT_COVER_STATUSES.has(response.status) };
        }
        const buffer = await readLimitedCover(response, deadline.signal);
        if (!buffer) return { retryable: false };
        const sniffed = sniffImageContentType(buffer);
        const headerType = response.headers.get('content-type') || '';
        const contentType = sniffed || (headerType.toLowerCase().startsWith('image/') ? headerType : '');
        if (!contentType) return { retryable: false };
        try {
            await waitForCoverOperation(() => bucket.put(key, buffer, {
                httpMetadata: { contentType }
            }), deadline.signal);
        } catch { return { retryable: false }; }
        return { cachedUrl: `/api/paas-v2/covers/${coverKey(coverUrl, coverExtension(coverUrl))}` };
    } catch {
        return { retryable: !deadline.signal.aborted };
    } finally {
        deadline.dispose();
    }
}

async function searchDayuCover(keyword, token, signal) {
    if (!keyword || !token || signal.aborted) return { cover: '', introduce: '' };
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
            redirect: 'manual',
            signal
        });
        if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            return { cover: '', introduce: '' };
        }
        const payload = await response.json();
        const items = payload?.data?.content || [];
        const first = items[0] || {};
        return { cover: first.cover || '', introduce: first.introduce || '' };
    } catch {
        return { cover: '', introduce: '' };
    }
}

async function fetchDayuCoverMap(signal) {
    const username = String(getEnv('DAYU_COVER_USERNAME', '')).trim();
    const password = String(getEnv('DAYU_COVER_PASSWORD', ''));
    if (!username || !password || signal.aborted) return emptyCoverIndex();
    try {
        const loginResponse = await fetch(DAYU_LOGIN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password
            }),
            redirect: 'manual',
            signal
        });
        if (!loginResponse.ok) {
            void loginResponse.body?.cancel().catch(() => {});
            return emptyCoverIndex();
        }
        const loginJson = await loginResponse.json();
        const token = loginJson?.data?.access_token;
        if (!token) return emptyCoverIndex();

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
            redirect: 'manual',
            signal
        });
        if (!hotResponse.ok) {
            void hotResponse.body?.cancel().catch(() => {});
            return emptyCoverIndex();
        }
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
        return emptyCoverIndex();
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

router.get('/platforms', authMiddleware, async (_req, res) => {
    try { return res.json(await listPlatforms()); }
    catch (error) { return res.status(500).json({ error: error.message || '智能体软件列表读取失败' }); }
});

router.post('/platforms', authMiddleware, adminOnly, async (req, res) => {
    try {
        const platform = normalizePlatformInput(req.body);
        if (await findPlatform(platform.softwareUnique)) return res.status(409).json({ error: '该 softwareUnique 已存在' });
        const [result] = await pool.query('INSERT INTO paas_v2_platforms (software_unique, code, name, theme, sort_order) VALUES (?, ?, ?, ?, ?)',
            [platform.softwareUnique, platform.code, platform.name, platform.theme, 1000]);
        return res.status(201).json({ ...platform, id: result.insertId, builtin: false });
    } catch (error) { return res.status(error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: error.message || '软件平台创建失败' }); }
});

router.put('/platforms/:softwareUnique', authMiddleware, adminOnly, async (req, res) => {
    try {
        const stored = await findPlatform(req.params.softwareUnique);
        if (!stored) return res.status(404).json({ error: '软件平台不存在' });
        const platform = normalizePlatformInput(req.body);
        if (stored.builtin && platform.softwareUnique !== stored.software_unique) return res.status(400).json({ error: '内置平台的 softwareUnique 不可修改' });
        const conflict = await findPlatform(platform.softwareUnique);
        if (conflict && conflict.id !== stored.id) return res.status(409).json({ error: '该 softwareUnique 已存在' });
        const scope = [stored.id, stored.catalog_generation];
        const identityChanged = platform.softwareUnique !== stored.software_unique;
        const statements = [[
            `UPDATE competitions SET paas_v2_software_unique = ?, category = ?
             WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE
               AND EXISTS (SELECT 1 FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?)`,
            [platform.softwareUnique, platform.name, stored.software_unique, ...scope]
        ]];
        if (identityChanged) statements.push([
            `DELETE FROM paas_v2_catalogs WHERE platform_id IN
                (SELECT id FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?)`,
            scope
        ]);
        statements.push([
            `UPDATE paas_v2_platforms SET software_unique = ?, code = ?, name = ?, theme = ?,
                catalog_generation = catalog_generation + ?,
                catalog_sync_status = CASE WHEN ? THEN 'never' ELSE catalog_sync_status END,
                catalog_synced_at = CASE WHEN ? THEN NULL ELSE catalog_synced_at END,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND catalog_generation = ?`,
            [platform.softwareUnique, platform.code, platform.name, platform.theme,
                identityChanged, identityChanged, identityChanged, ...scope]
        ]);
        const results = await pool.batch(statements);
        if (!results.at(-1).affectedRows) return res.status(409).json({ error: '平台已变更，请刷新后重试' });
        return res.json({ ...platform, id: stored.id, builtin: Boolean(stored.builtin) });
    } catch (error) { return res.status(error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500)).json({ error: error.message || '软件平台更新失败' }); }
});

router.delete('/platforms/:softwareUnique', authMiddleware, adminOnly, async (req, res) => {
    try {
        const platform = await findPlatform(req.params.softwareUnique);
        if (!platform) return res.status(404).json({ error: '软件平台不存在' });
        if (!await deletePlatformAndTasks(platform)) {
            return res.status(409).json({ error: '平台已变更，请刷新后重试' });
        }
        return res.json({ success: true });
    } catch (error) { return res.status(500).json({ error: error.message || '软件平台删除失败' }); }
});

router.post('/platforms/import', authMiddleware, adminOnly, async (req, res) => {
    try {
        const input = req.body?.platforms;
        if (!Array.isArray(input) || input.length > 200) return res.status(400).json({ error: '平台数据格式无效，单次最多导入 200 个平台' });
        const normalized = input.map(normalizePlatformInput);
        const statements = [];
        const seen = new Set();
        for (const platform of normalized) {
            const key = platform.softwareUnique.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            const existing = await findPlatform(platform.softwareUnique);
            if (!existing) {
                statements.push(['INSERT OR IGNORE INTO paas_v2_platforms (software_unique, code, name, theme) VALUES (?, ?, ?, ?)', [platform.softwareUnique, platform.code, platform.name, platform.theme]]);
            } else {
                // Migrate untouched built-in defaults without overwriting a cloud edit.
                const defaults = SOFTWARE_UNIQUE_OPTIONS.find(item => item.softwareUnique.toLowerCase() === key);
                if (existing.builtin && defaults && existing.code === defaults.id && existing.name === defaults.name && existing.theme === 'violet') {
                    statements.push(['UPDATE paas_v2_platforms SET code = ?, name = ?, theme = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [platform.code, platform.name, platform.theme, existing.id]]);
                }
            }
        }
        await pool.batch(statements);
        return res.json({ success: true, platforms: await listPlatforms() });
    } catch (error) { return res.status(error.status || 500).json({ error: error.message || '旧版本地软件数据迁移失败' }); }
});

router.get('/options', authMiddleware, adminOnly, async (_req, res) => {
    try { return res.json(await listPlatforms()); }
    catch (error) { return res.status(500).json({ error: error.message || '软件平台读取失败' }); }
});

async function fetchPlatformTaskRows(softwareUnique, externalSignal) {
    const catalogDeadline = deadlineSignal(20000, externalSignal);
    let payload;
    try {
        const response = await fetch(SYNC_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(softwareUnique)}`, redirect: 'manual', signal: catalogDeadline.signal });
        if (!response.ok) throw new Error(`任务目录请求失败：HTTP ${response.status}`);
        try {
            payload = parseCatalogPayload(await response.text());
        } catch { throw new Error('任务目录返回格式无效'); }
    } finally { catalogDeadline.dispose(); }
    if (String(payload.code) !== '0') throw new Error(payload.msg || '任务目录返回异常');
    if (!payload.data) throw Object.assign(new Error('未找到该 softwareUnique 对应的软件任务目录'), { notFound: true });
    return toTaskRows(payload.data);
}

async function fetchPlatformCatalog(softwareUnique, externalSignal) {
    const tasks = await fetchPlatformTaskRows(softwareUnique, externalSignal);
    if (!tasks.length) return tasks;
    const enhancementDeadline = deadlineSignal(coverEnhancementTimeout(), externalSignal);
    try {
        const coverIndex = await fetchDayuCoverMap(enhancementDeadline.signal);
        return await runWithConcurrency(tasks, 4, async task => {
            const hit = coverIndex.byId.get(String(task.plugFlag));
            let cover = hit?.cover || matchCover(task.title, task.plugName, coverIndex.byName);
            let introduce = hit?.introduce || matchIntroduce(task.title, task.plugName, coverIndex.byName);
            if (!cover || !introduce) {
                const searched = await searchDayuCover(task.title, coverIndex.token, enhancementDeadline.signal);
                cover ||= searched.cover; introduce ||= searched.introduce;
            }
            return { ...task, cover, introduce };
        });
    } finally { enhancementDeadline.dispose(); }
}

router.get('/catalog', authMiddleware, adminOnly, async (req, res) => {
    const softwareUnique = asSoftwareUnique(req.query.softwareUnique);
    if (!isValidSoftwareUnique(softwareUnique)) return res.status(400).json({ error: 'softwareUnique 格式无效，仅支持字母、数字、点、下划线和中划线' });
    try {
        const platform = await findPlatform(softwareUnique);
        if (!platform) return res.status(404).json({ error: '请先保存这个软件平台' });
        const scope = [platform.id, platform.catalog_generation];
        const [[saved]] = await pool.query(
            `SELECT c.tasks_json, c.updated_at, p.catalog_synced_at
             FROM paas_v2_catalogs c JOIN paas_v2_platforms p ON p.id = c.platform_id
             WHERE p.id = ? AND p.catalog_generation = ?`, scope
        );
        const data = { softwareUnique: platform.software_unique, platformCode: platform.code, platformName: platform.name };
        // A classification refresh can save module names before a complete catalog exists.
        if (saved?.catalog_synced_at && req.query.force !== '1') {
            return res.json({ ...data, ...publicCatalog(parseSavedCatalog(saved.tasks_json)), source: 'database', syncedAt: saved.updated_at });
        }
        try {
            const sourceTasks = await fetchPlatformCatalog(platform.software_unique, req.raw.signal);
            const [cards] = await pool.query(`SELECT paas_v2_plug_flag AS plugFlag FROM competitions
                WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE`, [platform.software_unique]);
            const importedFlags = new Set(cards.map(card => platformKey(card.plugFlag)));
            const { tasks } = await saveCatalogUpdate(platform, previous => {
                if (!sourceTasks.length && previous.length) throw new Error('云端返回空目录，已保留现有任务');
                return { tasks: mergeCatalogSnapshot(previous, sourceTasks, importedFlags) };
            }, { markSynced: true });
            return res.json({ ...data, ...publicCatalog(tasks), source: 'remote' });
        } catch (error) {
            if (error.status === 409) return res.status(409).json({ error: error.message });
            const [updated, latest] = await pool.batch([
                ['UPDATE paas_v2_platforms SET catalog_sync_status = ? WHERE id = ? AND catalog_generation = ?',
                    [error.notFound ? 'not_found' : 'error', ...scope]],
                [`SELECT c.tasks_json, c.updated_at FROM paas_v2_catalogs c JOIN paas_v2_platforms p ON p.id = c.platform_id
                    WHERE p.id = ? AND p.catalog_generation = ? AND p.catalog_synced_at IS NOT NULL`, scope]
            ]);
            if (!updated.affectedRows) return res.status(409).json({ error: '平台已变更，请刷新后重试' });
            const fallback = latest.rows[0];
            const message = error.message || '任务目录获取失败';
            if (fallback) return res.json({ ...data, ...publicCatalog(parseSavedCatalog(fallback.tasks_json)), source: 'database-fallback', syncedAt: fallback.updated_at, refreshError: message });
            return res.status(502).json({ error: message });
        }
    } catch (error) {
        console.error('[paas-v2-catalog]', error.message);
        return res.status(500).json({ error: error.message || '任务目录获取失败' });
    }
});

const catalogModuleFields = ['moduleId', 'moduleTitle', 'moduleOrder', 'taskOrder'];
const hasCatalogModuleTitle = task => typeof task?.moduleTitle === 'string' && task.moduleTitle.trim() !== '';

function publicCatalog(snapshot) {
    const tasks = snapshot.filter(task => task?.missingFromSource !== true)
        .map(task => ({ ...task, answerType: PAAS_V2_ANSWER_TYPE }));
    return { tasks, missingTaskCount: snapshot.length - tasks.length };
}

function mergeCatalogSnapshot(savedTasks, sourceTasks, importedFlags) {
    const savedByFlag = new Map(savedTasks.map(task => [platformKey(task?.plugFlag), task]));
    const previousModules = new Map();
    for (const task of savedTasks) {
        if (!task?.moduleId || !hasCatalogModuleTitle(task)) continue;
        if (!task.missingFromSource || !previousModules.has(task.moduleId)) previousModules.set(task.moduleId, task);
    }
    const preserveModule = (task, previous) => {
        if (hasCatalogModuleTitle(task)) return task;
        const module = hasCatalogModuleTitle(previous) ? previous : previousModules.get(previous?.moduleId);
        if (!module) return task;
        return {
            ...task, moduleId: module.moduleId, moduleTitle: module.moduleTitle,
            moduleOrder: module.moduleOrder, taskOrder: previous?.taskOrder ?? task.taskOrder
        };
    };
    const tasks = sourceTasks.map(task => {
        const flag = platformKey(task.plugFlag);
        const previous = savedByFlag.get(flag);
        savedByFlag.delete(flag);
        return preserveModule(task, previous);
    });
    for (const [flag, task] of savedByFlag) {
        if (flag && importedFlags.has(flag)) tasks.push({ ...preserveModule(task, task), missingFromSource: true });
    }
    return tasks;
}

function mergeCatalogModules(savedTasks, sourceByFlag) {
    const existingFlags = new Set();
    let updated = 0;
    const tasks = savedTasks.map(task => {
        const flag = platformKey(task?.plugFlag);
        existingFlags.add(flag);
        const source = sourceByFlag.get(flag);
        if (!source || catalogModuleFields.every(field => task[field] === source[field])) return task;
        updated += 1;
        return {
            ...task, moduleId: source.moduleId, moduleTitle: source.moduleTitle,
            moduleOrder: source.moduleOrder, taskOrder: source.taskOrder
        };
    });
    for (const [flag, task] of sourceByFlag) {
        if (existingFlags.has(flag)) continue;
        tasks.push(task);
        updated += 1;
    }
    return { tasks, updated };
}

async function saveCatalogUpdate(platform, update, { markSynced = false } = {}) {
    const scope = [platform.id, platform.catalog_generation];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const [[saved]] = await pool.query(
            `SELECT c.tasks_json FROM paas_v2_platforms p
             LEFT JOIN paas_v2_catalogs c ON c.platform_id = p.id
             WHERE p.id = ? AND p.catalog_generation = ?`, scope
        );
        if (!saved) throw Object.assign(new Error('平台已变更，请刷新后重试'), { status: 409 });
        const merged = update(parseSavedCatalog(saved.tasks_json));
        if (merged.updated === 0) return merged;
        const data = JSON.stringify(merged.tasks);
        const write = saved.tasks_json !== null
            ? [`UPDATE paas_v2_catalogs SET tasks_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE platform_id = ? AND tasks_json = ? AND EXISTS (
                    SELECT 1 FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?
                )`, [data, platform.id, saved.tasks_json, ...scope]]
            : [`INSERT INTO paas_v2_catalogs (platform_id, tasks_json)
                SELECT id, ? FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?
                ON CONFLICT(platform_id) DO NOTHING`, [data, ...scope]];
        const [result] = await pool.batch(markSynced ? [write, [
            `UPDATE paas_v2_platforms SET catalog_sync_status = 'ok', catalog_synced_at = CURRENT_TIMESTAMP
             WHERE id = ? AND catalog_generation = ? AND changes() > 0`, scope
        ]] : [write]);
        if (result.affectedRows) return merged;
    }
    throw Object.assign(new Error('目录正在更新，请稍后重试'), { status: 409 });
}

router.post('/catalog/modules/refresh', authMiddleware, adminOnly, async (req, res) => {
    const softwareUnique = asSoftwareUnique(req.body?.softwareUnique);
    if (!isValidSoftwareUnique(softwareUnique)) return res.status(400).json({ error: 'softwareUnique 格式无效' });
    try {
        const platform = await findPlatform(softwareUnique);
        if (!platform) return res.status(404).json({ error: '请先保存这个软件平台' });
        let sourceTasks;
        try {
            sourceTasks = await fetchPlatformTaskRows(platform.software_unique, req.raw.signal);
        } catch (error) {
            return res.status(error.notFound ? 404 : 502).json({ error: '云端任务目录读取失败，已保留现有分类' });
        }
        const sourceByFlag = new Map(sourceTasks.filter(hasCatalogModuleTitle)
            .map(task => [platformKey(task.plugFlag), task]));
        const { tasks, updated } = await saveCatalogUpdate(platform, previous => mergeCatalogModules(previous, sourceByFlag));
        const namedFlags = new Set(tasks.filter(hasCatalogModuleTitle).map(task => platformKey(task.plugFlag)));
        const sourceFlags = new Set(sourceTasks.map(task => platformKey(task.plugFlag)));
        const [cards] = await pool.query(`SELECT paas_v2_plug_flag AS plugFlag FROM competitions
            WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE`, [platform.software_unique]);
        return res.json({
            softwareUnique: platform.software_unique, updated, classified: namedFlags.size, total: tasks.length,
            sourceClassified: sourceByFlag.size, cardTotal: cards.length,
            classifiedCards: cards.filter(card => namedFlags.has(platformKey(card.plugFlag))).length,
            missingCards: cards.filter(card => !sourceFlags.has(platformKey(card.plugFlag))).length
        });
    } catch (error) {
        console.error('[paas-v2-catalog-modules]', error.code || error.name);
        return res.status(error.status || 500).json({ error: error.status === 409 ? error.message : '任务分类保存失败' });
    }
});

async function withPaasV2Task(req, action) {
    const competitionId = Number(req.body?.competitionId);
    if (!Number.isInteger(competitionId) || competitionId <= 0) {
        throw Object.assign(new Error('竞赛卡片编号无效'), { status: 400 });
    }
    const { user } = req;
    await assertCompetitionAccess(user, competitionId);
    return withD1Lock(`paas-v2-task:${user.id}:${competitionId}`, async () => {
        const [[card]] = await pool.query(
            `SELECT id, url, sso_config_id AS ssoConfigId, sso_method AS ssoMethod,
                    paas_v2_plug_flag AS plugFlag,
                    paas_v2_software_unique AS softwareUnique
             FROM competitions WHERE id = ?`,
            [competitionId]
        );
        if (!card || card.ssoMethod !== 'paasV2') {
            throw Object.assign(new Error('该卡片不是智能体任务'), { status: 400 });
        }
        const [[sso]] = await pool.query('SELECT config_data FROM sso_configs WHERE id = ?', [card.ssoConfigId]);
        if (!sso) {
            throw Object.assign(new Error('该智能体任务尚未绑定免密配置'), { status: 409 });
        }
        const stored = decodeStoredConfig(sso.config_data || {});
        if (stored.method !== 'paasV2' || stored.canaryOnly === true) {
            throw Object.assign(new Error('该智能体任务绑定了无效的免密配置'), { status: 409 });
        }
        const config = mapCardAddressToOfficialConfig({
            ...stored,
            plugFlag: card.plugFlag || stored.plugFlag,
            answerType: PAAS_V2_ANSWER_TYPE,
            softwareUnique: card.softwareUnique || stored.softwareUnique
        }, card.url);
        const context = { user, loginRole: 'student', cardUrl: card.url };
        validateOfficialTransportAddress(config, context);
        const baseUrl = selectOfficialBaseUrl(config, context);
        const safeFetch = createOfficialSafeFetch({
            baseUrl,
            allowHttp: config.allowHttp === true,
            timeoutMs: 15000
        });
        const deadline = deadlineSignal(50000);
        const fetchImplementation = async (input, options) => {
            deadline.signal.throwIfAborted();
            const response = await safeFetch(input, { ...options, signal: deadline.signal });
            deadline.signal.throwIfAborted();
            return response;
        };
        try {
            const adapter = createPaasV2Adapter({
                config,
                fetchImplementation,
                tokenStore: getRuntime().paasV2TokenStore
            });
            const parameters = mapMarchCenterToOfficialParameters(config, context, baseUrl);
            return await action({ adapter, parameters, context, card });
        } finally {
            deadline.dispose();
        }
    }, { leaseMs: 90000 });
}

const currentPaasV2Binding = `SELECT 1 FROM competitions WHERE id = ? AND sso_method = 'paasV2'
    AND sso_config_id IS ? AND url IS ? AND NULLIF(paas_v2_plug_flag, '') IS ?
    AND NULLIF(paas_v2_software_unique, '') IS ?`;

function paasV2BindingValues(card) {
    return [card.id, card.ssoConfigId, card.url, card.plugFlag || null, card.softwareUnique || null];
}

router.post('/result', authMiddleware, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
        const result = await withPaasV2Task(req, async ({ adapter, parameters, context, card }) => {
            const result = await adapter.getTaskResult(parameters, context);
            const [saved] = await pool.query(
                `INSERT INTO user_agent_task_results
                    (user_id, competition_id, sso_config_id, target_url, task_id,
                     answer_type, software_unique, status, score)
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${currentPaasV2Binding})
                 ON CONFLICT(user_id, competition_id) DO UPDATE SET
                    sso_config_id = excluded.sso_config_id,
                    target_url = excluded.target_url,
                    task_id = excluded.task_id,
                    answer_type = excluded.answer_type,
                    software_unique = excluded.software_unique,
                    status = excluded.status,
                    score = excluded.score`,
                [req.user.id, card.id, card.ssoConfigId, card.url, card.plugFlag,
                    PAAS_V2_ANSWER_TYPE, card.softwareUnique, result.status, result.score, ...paasV2BindingValues(card)]
            );
            if (!saved.affectedRows) throw Object.assign(new Error('任务绑定已更新，请刷新任务列表'), { status: 409 });
            return result;
        });
        return res.json(result);
    } catch (error) {
        console.error('[paas-v2-result]', error.code || error.name);
        const status = error.code?.startsWith('PAAS_V2_') ? 502 : (error.status || 502);
        return res.status(status).json({ error: status < 500 && error.message ? error.message : '成绩暂时无法查询，请稍后刷新' });
    }
});

router.post('/reset', authMiddleware, async (req, res) => {
    try {
        await withPaasV2Task(req, async ({ adapter, parameters, card }) => {
            await adapter.resetTaskData(parameters);
            const values = paasV2BindingValues(card);
            const [current] = await pool.batch([
                [`SELECT EXISTS (${currentPaasV2Binding}) AS matches`, values],
                ...['user_workflow_status', 'user_agent_task_results'].map(table => [
                    `DELETE FROM ${table} WHERE user_id = ? AND competition_id = ? AND EXISTS (${currentPaasV2Binding})`,
                    [req.user.id, card.id, ...values]
                ])
            ]);
            if (!current.rows[0].matches) throw Object.assign(new Error('任务绑定已更新，请刷新任务列表'), { status: 409 });
        });
        return res.json({ success: true });
    } catch (error) {
        console.error('[paas-v2-reset]', error.code || error.name);
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
    const input = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (input.length > MAX_COVER_BATCH_SIZE) return res.status(400).json({ error: `每次最多缓存 ${MAX_COVER_BATCH_SIZE} 张封面`, code: 'cover_batch_too_large' });
    const urls = [...new Set(input.map(value => String(value || '').trim()).filter(Boolean))];
    if (!urls.length) return res.status(400).json({ error: '请提供需要缓存的封面地址' });
    const deadline = deadlineSignal(COVER_BATCH_TIMEOUT_MS, req.raw.signal);
    try {
        urls.forEach(validateCoverCacheUrl);
        const entries = await runWithConcurrency(urls, 4, async url => [url, await cacheCover(url, deadline.signal)]);
        return res.json({ covers: Object.fromEntries(entries) });
    } catch (error) {
        console.error('[paas-v2-cover-cache]', error.message);
        return res.status(error.status || 502).json({
            error: error.message || '封面缓存失败',
            ...(error.code === 'cover_url_not_allowed' ? { code: error.code } : {})
        });
    } finally { deadline.dispose(); }
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
