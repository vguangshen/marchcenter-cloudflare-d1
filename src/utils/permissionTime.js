export const TIME_INCREMENT_OPTIONS = [
    { label: '+1小时', amount: 1, unit: 'hours' },
    { label: '+1天', amount: 1, unit: 'days' },
    { label: '+2天', amount: 2, unit: 'days' },
    { label: '+3天', amount: 3, unit: 'days' },
    { label: '+7天', amount: 7, unit: 'days' },
    { label: '+30天', amount: 30, unit: 'days' },
    { label: '+60天', amount: 60, unit: 'days' }
];

export function formatPermissionTime(date) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const getNowString = () => formatPermissionTime(new Date());

export function incrementPermissionTime(value, amount = 1, unit = 'hours') {
    let date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();
    if (unit === 'days') date.setDate(date.getDate() + amount);
    else date.setHours(date.getHours() + amount);
    return formatPermissionTime(date);
}

export function getPermissionCounts(allLinks = [], selectedIds = []) {
    const links = Array.isArray(allLinks) ? allLinks : [];
    const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(String));
    const agents = links.filter(link => link?.ssoMethod === 'paasV2');
    const platforms = links.filter(link => link?.ssoMethod !== 'paasV2');
    const countSelected = items => items.filter(item => selected.has(String(item.id))).length;
    return {
        totalPlatform: platforms.length,
        selectedPlatform: countSelected(platforms),
        totalAgent: agents.length,
        selectedAgent: countSelected(agents)
    };
}

export function applySelectedTimeRules(timeRules, selectedIds, batchTime) {
    if (!selectedIds.length || (!batchTime.unlockTime && !batchTime.lockTime)) return timeRules;
    const next = { ...timeRules };
    selectedIds.forEach(id => {
        next[id] = {
            ...next[id],
            ...(batchTime.unlockTime ? { unlockTime: batchTime.unlockTime } : {}),
            ...(batchTime.lockTime ? { lockTime: batchTime.lockTime } : {})
        };
    });
    return next;
}

export function clearSelectedTimeRules(timeRules, selectedIds) {
    const next = { ...timeRules };
    selectedIds.forEach(id => {
        if (!next[id]) return;
        const rule = { ...next[id] };
        delete rule.unlockTime;
        delete rule.lockTime;
        if (Object.keys(rule).length) next[id] = rule;
        else delete next[id];
    });
    return next;
}
