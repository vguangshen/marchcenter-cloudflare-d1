import pool from '../config/db.js';

const PLATFORM_THEME_VALUES = new Set(['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'fuchsia', 'slate', 'indigo', 'sky', 'teal', 'lime', 'yellow', 'orange', 'red', 'pink']);
const SJFXAH_LEGACY_TASK_MODULES = new Map([
    ['市场分析', ['市场趋势分析', '行业数据分析', '竞争对手分析']],
    ['供应链数据分析', ['生产效率分析', '采购数据分析', '供应链绩效分析', '库存数据分析', '物流数据分析']],
    ['营销推广分析', ['营销渠道分析', '推广数据分析', '活动效果分析']],
    ['商品销售分析', ['销售趋势分析', '订单数据分析']],
    ['客户数据分析', ['客户数据分析智能体搭建']],
    ['财务数据分析', ['经营成本分析', '现金流量分析']]
].flatMap(([title, tasks], index) => {
    const module = { title, order: index + 1 };
    return tasks.map((task, position) => [task, { module, taskOrder: position + 1 }]);
}));
export const platformKey = value => String(value ?? '').trim().toLowerCase();
const requestError = (message, status = 400) => Object.assign(new Error(message), { status });

export function normalizePlatformInput(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw requestError('平台数据格式无效');
    const softwareUnique = String(input.softwareUnique || '').trim();
    const code = String(input.code || '').trim();
    const name = String(input.name || '').trim();
    const themeInput = platformKey(input.theme || 'violet');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(softwareUnique)) throw requestError('softwareUnique 格式无效，仅支持字母、数字、点、下划线和中划线');
    if (!code || code.length > 80 || !name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(code + name)) throw requestError('请填写有效的软件代码和软件名称');
    if (!PLATFORM_THEME_VALUES.has(themeInput)) throw requestError('模块主题色无效');
    return { softwareUnique, code, name, theme: themeInput };
}

export function parseSavedCatalog(value) {
    try { const tasks = JSON.parse(value || '[]'); return Array.isArray(tasks) ? tasks : []; }
    catch { return []; }
}

function catalogOrder(value) {
    const order = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    return Number.isSafeInteger(order) ? order : null;
}

const catalogText = value => typeof value === 'string' ? value.trim() : '';
const catalogModuleId = task => String(task?.moduleId ?? '').trim();

function setUnambiguous(index, key, value) {
    const previous = index.get(key);
    index.set(key, previous === undefined || previous === value ? value : null);
}

function indexTaskModules(tasks, platform) {
    const tasksByFlag = new Map();
    const officialById = new Map();
    const legacyById = new Map();
    const idByLegacyTitle = new Map();
    for (const task of tasks) {
        const plugFlag = platformKey(task?.plugFlag);
        if (!plugFlag) continue;
        tasksByFlag.set(plugFlag, task);
        const id = catalogModuleId(task);
        if (!id) continue;
        const title = catalogText(task.moduleTitle);
        if (title && (!task.missingFromSource || !officialById.has(id))) {
            officialById.set(id, { title, order: catalogOrder(task.moduleOrder) });
        }
        const legacy = platform === 'sjfxah' && SJFXAH_LEGACY_TASK_MODULES.get(catalogText(task.title));
        if (legacy) setUnambiguous(legacyById, id, legacy.module);
    }
    for (const [id, module] of legacyById) {
        if (module) setUnambiguous(idByLegacyTitle, module.title, id);
    }
    return { tasksByFlag, officialById, legacyById, idByLegacyTitle };
}

export async function attachAgentTaskModules(cards) {
    const agentCards = cards.filter(card => card.ssoMethod === 'paasV2');
    const platformKeys = [...new Set(agentCards.map(card => platformKey(card.paasV2SoftwareUnique)).filter(Boolean))];
    const catalogsByPlatform = new Map();
    if (platformKeys.length) {
        const [catalogs] = await pool.query(`SELECT p.software_unique, c.tasks_json
            FROM paas_v2_platforms p JOIN paas_v2_catalogs c ON c.platform_id = p.id
            WHERE p.software_unique COLLATE NOCASE IN (SELECT value FROM json_each(?))`, [JSON.stringify(platformKeys)]);
        for (const catalog of catalogs) {
            const platform = platformKey(catalog.software_unique);
            catalogsByPlatform.set(platform, indexTaskModules(parseSavedCatalog(catalog.tasks_json), platform));
        }
    }
    for (const card of agentCards) {
        const platform = platformKey(card.paasV2SoftwareUnique);
        const catalog = catalogsByPlatform.get(platform);
        const task = catalog?.tasksByFlag.get(platformKey(card.paasV2PlugFlag));
        const legacy = platform === 'sjfxah' ? SJFXAH_LEGACY_TASK_MODULES.get(catalogText(task?.title || card.title)) : null;
        const moduleId = catalogModuleId(task) || catalog?.idByLegacyTitle.get(legacy?.module.title);
        const catalogTitle = catalogText(task?.moduleTitle);
        const ownModule = catalogTitle ? { title: catalogTitle, order: catalogOrder(task.moduleOrder) } : null;
        const sharedModule = catalog?.officialById.get(moduleId);
        const official = task?.missingFromSource ? sharedModule || ownModule : ownModule || sharedModule;
        const legacyById = catalog?.legacyById.get(moduleId);
        const module = official || legacyById || legacy?.module;
        const useCatalogId = moduleId && (official || legacyById);
        card.agentModule = module ? {
            id: useCatalogId ? moduleId : `title:${module.title}`,
            title: module.title,
            order: module.order,
            taskOrder: catalogOrder(task?.taskOrder) ?? (module.title === legacy?.module.title ? legacy.taskOrder : null)
        } : null;
    }
}

export async function findPlatform(softwareUnique) {
    const [[platform]] = await pool.query('SELECT * FROM paas_v2_platforms WHERE software_unique = ? COLLATE NOCASE LIMIT 1', [String(softwareUnique || '').trim()]);
    return platform || null;
}

export async function listPlatforms() {
    const [rows] = await pool.query(`SELECT p.*,
        (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(c.tasks_json) THEN
            CASE WHEN json_type(c.tasks_json) = 'array' THEN c.tasks_json END END) task
            WHERE (CASE WHEN task.type = 'object' THEN json_extract(task.value, '$.missingFromSource') END) IS NOT 1
        ) AS catalogTaskCount,
        COALESCE(t.taskCount, 0) AS taskCount
        FROM paas_v2_platforms p LEFT JOIN paas_v2_catalogs c ON c.platform_id = p.id
        LEFT JOIN (SELECT paas_v2_software_unique COLLATE NOCASE AS platformKey, COUNT(*) AS taskCount
            FROM competitions WHERE sso_method = 'paasV2' GROUP BY paas_v2_software_unique COLLATE NOCASE) t
            ON t.platformKey = p.software_unique COLLATE NOCASE
        ORDER BY p.builtin DESC, p.sort_order, p.code`);
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, softwareUnique: row.software_unique,
        theme: row.theme, builtin: Boolean(row.builtin), sortOrder: row.sort_order, taskCount: Number(row.taskCount) || 0,
        catalogTaskCount: Number(row.catalogTaskCount) || 0, catalogSyncStatus: row.catalog_sync_status,
        catalogSyncedAt: row.catalog_synced_at || null }));
}

export const competitionDependentTables = Object.freeze([
    'user_competition_student_accounts', 'user_manual_teacher_credentials', 'user_competition_expert_student_bindings',
    'user_competition_expert_accounts', 'user_class_removals', 'user_workflow_status', 'user_platform_account_status',
    'user_permissions', 'user_competition_time_rules'
]);

export async function deletePlatformAndTasks(platform) {
    const scope = [platform.id, platform.catalog_generation];
    const platformQuery = 'SELECT id FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?';
    const taskFilter = `sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE
        AND EXISTS (${platformQuery})`;
    const params = [platform.software_unique, ...scope];
    const statements = competitionDependentTables.map(table => [
        `DELETE FROM ${table} WHERE competition_id IN (SELECT id FROM competitions WHERE ${taskFilter})`, params
    ]);
    statements.push(
        [`DELETE FROM competitions WHERE ${taskFilter}`, params],
        [`DELETE FROM paas_v2_catalogs WHERE platform_id IN (${platformQuery})`, scope],
        ['DELETE FROM paas_v2_platforms WHERE id = ? AND catalog_generation = ?', scope]
    );
    const results = await pool.batch(statements);
    return results.at(-1).affectedRows > 0;
}
