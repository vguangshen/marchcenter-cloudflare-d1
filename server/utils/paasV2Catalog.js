import { PAAS_V2_ANSWER_TYPE } from './officialCompat/paasV2/paasV2Adapter.js';

const IDENTIFIER_FIELDS = new Set(['id', 'taskModuleId', 'plugId', 'plugFlag', 'plugIdBak']);
const TASK_COLLECTIONS = ['taskJson', 'plugMngJson', 'taskEnterInfoJson'];

export function parseCatalogPayload(text) {
    const payload = JSON.parse(text, (key, value, context) => (
        IDENTIFIER_FIELDS.has(key) && typeof value === 'number' && !Number.isSafeInteger(value)
            && /^-?\d+$/.test(context?.source) ? context.source : value
    ));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('任务目录返回格式无效');
    return payload;
}

const catalogText = value => typeof value === 'string' ? value.trim() : '';
const catalogId = value => Number.isSafeInteger(value) ? String(value) : catalogText(value);
const catalogRows = rows => Array.isArray(rows) ? rows : [];
const plugKey = id => id.toLowerCase();

function indexByPlugFlag(rows, getFlag) {
    const index = new Map();
    for (const row of rows) {
        const flag = getFlag(row);
        if (flag) index.set(plugKey(flag), { flag, row });
    }
    return index;
}

export function toTaskRows(data) {
    if (!TASK_COLLECTIONS.some(name => Array.isArray(data?.[name]))
        || TASK_COLLECTIONS.some(name => data?.[name] != null && !Array.isArray(data[name]))) {
        throw new Error('任务目录缺少有效的任务记录');
    }
    const moduleById = new Map(catalogRows(data.taskModuleJson)
        .map(module => [catalogId(module?.id), module]).filter(([id]) => id));
    const plugByFlag = indexByPlugFlag(catalogRows(data.plugMngJson), item => catalogId(item?.plugFlag));
    const appByFlag = indexByPlugFlag(catalogRows(data.taskEnterInfoJson), item => catalogId(item?.plugFlag));
    const taskByFlag = indexByPlugFlag(catalogRows(data.taskJson), task => {
        const ids = [task?.plugId, task?.plugFlag, task?.plugIdBak].map(catalogId).filter(Boolean);
        return ids.find(id => plugByFlag.has(plugKey(id)) || appByFlag.has(plugKey(id))) || ids[0];
    });
    const keys = new Set([...taskByFlag.keys(), ...plugByFlag.keys(), ...appByFlag.keys()]);
    return [...keys].map(key => {
        const taskEntry = taskByFlag.get(key);
        const plugEntry = plugByFlag.get(key);
        const appEntry = appByFlag.get(key);
        const task = taskEntry?.row || {};
        const plug = plugEntry?.row || {};
        const app = appEntry?.row || {};
        const plugFlag = appEntry?.flag || plugEntry?.flag || taskEntry.flag;
        const moduleIds = [task.taskModuleId, plug.taskModuleId].map(catalogId).filter(Boolean);
        const moduleId = moduleIds.find(id => moduleById.has(id)) || moduleIds[0] || null;
        const module = moduleById.get(moduleId);
        const plugName = catalogText(plug.plugName);
        return {
            plugFlag,
            title: catalogText(task.taskTitle) || plugName || plugFlag,
            plugName,
            answerType: PAAS_V2_ANSWER_TYPE,
            trainType: app.trainType ?? null,
            appType: app.appType ?? null,
            trainPath: app.trainPath || '',
            trainJumpPath: app.trainJumpPath || '',
            moduleId,
            moduleTitle: catalogText(module?.moduleTitle) || catalogText(task.taskModuleName),
            moduleOrder: module?.moduleOrder ?? null,
            taskOrder: task.taskOrder ?? plug.plugOrder ?? null
        };
    }).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}
