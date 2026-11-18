import React, { useId, useMemo, useRef, useState } from 'react';
import { Layers3 } from 'lucide-react';

const compareOrder = (left, right) => (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
const compareTitle = (left, right) => String(left || '').localeCompare(String(right || ''), 'zh-CN');

function groupTasks(items) {
    const modules = new Map();
    const other = { key: 'other', title: '其他任务', items: [] };

    for (const task of items) {
        const module = task.agentModule;
        if (!module?.title) {
            other.items.push(task);
            continue;
        }
        const key = module.id == null ? `title:${module.title}` : `module:${module.id}`;
        if (!modules.has(key)) modules.set(key, { key, title: module.title, order: module.order, items: [] });
        modules.get(key).items.push(task);
    }

    const groups = [...modules.values()].sort((left, right) => compareOrder(left.order, right.order)
        || compareTitle(left.title, right.title));
    if (other.items.length) groups.push(other);
    for (const group of groups) {
        group.items.sort((left, right) => compareOrder(left.agentModule?.taskOrder, right.agentModule?.taskOrder)
            || compareTitle(left.title, right.title));
    }
    return groups;
}

export default function AgentTaskGroups({ items, label, renderTask }) {
    const listId = useId();
    const scrollRef = useRef(null);
    const [selectedKey, setSelectedKey] = useState('all');
    const groups = useMemo(() => groupTasks(items), [items]);
    const hasModules = groups.some(group => group.key !== 'other');
    const selected = groups.length > 1 ? groups.find(group => group.key === selectedKey) : null;
    const filters = [{ key: 'all', title: '全部', items }, ...groups];
    const visibleGroups = selected ? [selected] : groups;

    function selectGroup(key) {
        setSelectedKey(key);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }

    return (
        <>
            {groups.length > 1 && (
                <div role="group" aria-label={`${label}任务分类`} className="mb-3 flex flex-wrap gap-1.5">
                    {filters.map(group => (
                        <button key={group.key} type="button" aria-label={`${group.title}，${group.items.length} 个任务`} aria-controls={listId}
                            aria-pressed={group.key === (selected?.key || 'all')}
                            onClick={() => selectGroup(group.key)}
                            className="mc-button mc-button--secondary agent-task-category max-w-full !min-h-10 !gap-1.5 !rounded-xl !px-2.5 !py-1 !text-xs">
                            <span className="min-w-0 whitespace-normal break-words">{group.title}</span>
                            <span aria-hidden="true" className="shrink-0 rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] tabular-nums">{group.items.length}</span>
                        </button>
                    ))}
                </div>
            )}
            <div id={listId} ref={scrollRef} className="agent-task-scroll" role="region" aria-label={`${label}任务列表`}>
                <div className="grid gap-3">
                    {visibleGroups.map(group => (
                        <section key={group.key}>
                            {hasModules && (
                                <div className="agent-task-category-heading mb-2 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2">
                                    <Layers3 aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                    <h4 className="min-w-0 flex-1 break-words text-xs font-bold">{group.title}</h4>
                                    <span className="shrink-0 text-[10px] font-medium tabular-nums">{group.items.length} 个任务</span>
                                </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                {group.items.map(renderTask)}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
        </>
    );
}
