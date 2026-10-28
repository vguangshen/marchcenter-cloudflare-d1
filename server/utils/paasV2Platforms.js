import pool from '../config/db.js';

const PLATFORM_THEME_VALUES = new Set(['violet', 'blue', 'cyan', 'emerald', 'amber', 'rose', 'fuchsia', 'slate', 'indigo', 'sky', 'teal', 'lime', 'yellow', 'orange', 'red', 'pink']);
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

export async function findPlatform(softwareUnique) {
    const [[platform]] = await pool.query('SELECT * FROM paas_v2_platforms WHERE software_unique = ? COLLATE NOCASE LIMIT 1', [String(softwareUnique || '').trim()]);
    return platform || null;
}

export async function listPlatforms() {
    const [rows] = await pool.query(`SELECT p.*, c.tasks_json AS tasksJson,
        (SELECT COUNT(*) FROM competitions t WHERE t.sso_method = 'paasV2' AND t.paas_v2_software_unique = p.software_unique COLLATE NOCASE) AS taskCount
        FROM paas_v2_platforms p LEFT JOIN paas_v2_catalogs c ON c.platform_id = p.id
        ORDER BY p.builtin DESC, p.sort_order, p.code`);
    return rows.map(row => ({ id: row.id, code: row.code, name: row.name, softwareUnique: row.software_unique,
        theme: row.theme, builtin: Boolean(row.builtin), sortOrder: row.sort_order, taskCount: Number(row.taskCount) || 0,
        catalogTaskCount: parseSavedCatalog(row.tasksJson).length, catalogSyncStatus: row.catalog_sync_status,
        catalogSyncedAt: row.catalog_synced_at || null }));
}

export const competitionDependentTables = Object.freeze([
    'user_competition_student_accounts', 'user_manual_teacher_credentials', 'user_competition_expert_student_bindings',
    'user_competition_expert_accounts', 'user_class_removals', 'user_workflow_status', 'user_platform_account_status',
    'user_permissions', 'user_competition_time_rules'
]);

export async function deletePlatformAndTasks(platform) {
    const taskQuery = "SELECT id FROM competitions WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE";
    const statements = competitionDependentTables.map(table => [`DELETE FROM ${table} WHERE competition_id IN (${taskQuery})`, [platform.software_unique]]);
    statements.push(["DELETE FROM competitions WHERE sso_method = 'paasV2' AND paas_v2_software_unique = ? COLLATE NOCASE", [platform.software_unique]],
        ['DELETE FROM paas_v2_catalogs WHERE platform_id = ?', [platform.id]], ['DELETE FROM paas_v2_platforms WHERE id = ?', [platform.id]]);
    await pool.batch(statements);
}
