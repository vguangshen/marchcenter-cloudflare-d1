import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRightLeft, Check, ChevronDown, Search } from 'lucide-react';

const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 320;
const SEARCH_THRESHOLD = 8;

/**
 * "调整班级" control: a button styled like the other row actions that opens
 * a searchable, keyboard-navigable class list in a glass popover. The panel
 * is portalled to <body> so scrolling containers never clip it, and opens
 * upward when there is not enough room below.
 */
export default function ClassPicker({ classes, value, onChange, label, className = '' }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const [position, setPosition] = useState(null);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const listId = useId();

    const current = classes.find(item => String(item.id) === String(value));
    const searchable = classes.length > SEARCH_THRESHOLD;
    const filtered = useMemo(() => {
        const text = query.trim().toLowerCase();
        if (!text) return classes;
        return classes.filter(item => `${item.name} ${item.teacherUsername || ''}`.toLowerCase().includes(text));
    }, [classes, query]);

    const close = useCallback((restoreFocus = true) => {
        setOpen(false);
        setQuery('');
        if (restoreFocus) triggerRef.current?.focus();
    }, []);

    const place = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.max(rect.width, 240);
        const below = window.innerHeight - rect.bottom - PANEL_GAP - 8;
        const above = rect.top - PANEL_GAP - 8;
        const upward = below < Math.min(PANEL_MAX_HEIGHT, 220) && above > below;
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
        setPosition({
            // The dashboard applies `dark` on its own root, not <html>; carry it into the portal.
            dark: Boolean(triggerRef.current.closest(".dark")),
            left,
            width,
            upward,
            maxHeight: Math.max(160, Math.min(PANEL_MAX_HEIGHT, upward ? above : below)),
            top: upward ? undefined : rect.bottom + PANEL_GAP,
            bottom: upward ? window.innerHeight - rect.top + PANEL_GAP : undefined
        });
    }, []);

    const openPanel = () => {
        const index = classes.findIndex(item => String(item.id) === String(value));
        setActive(Math.max(0, index));
        setOpen(true);
    };

    useLayoutEffect(() => {
        if (!open) return undefined;
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open, place]);

    // Close on any press outside the trigger and the panel.
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = event => {
            if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
            close(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [open, close]);

    // Focus the search box (or the list) once the panel is placed.
    useEffect(() => {
        if (!open || !position) return;
        (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    }, [open, position, searchable]);

    // Keep the highlighted option visible.
    useEffect(() => {
        if (!open) return;
        listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active, open, filtered]);

    const choose = item => {
        if (item && String(item.id) !== String(value)) onChange(item.id);
        close();
    };

    const onKeyDown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab') { close(false); return; }
        if (!filtered.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % filtered.length); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + filtered.length) % filtered.length); }
        else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
        else if (event.key === 'End') { event.preventDefault(); setActive(filtered.length - 1); }
        else if (event.key === 'Enter') { event.preventDefault(); choose(filtered[active]); }
    };


    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                onClick={() => (open ? close() : openPanel())}
                onKeyDown={event => {
                    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openPanel(); }
                }}
                className={`class-picker-trigger ${className}`}
            >
                <ArrowRightLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
                调整班级
                <span aria-hidden="true" className="class-picker-divider" />
                <span className="class-picker-value">{current?.name || '选择班级'}</span>
                <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && position && createPortal(
                <div className={position.dark ? 'dark' : undefined}>
                    <div
                        ref={panelRef}
                        className={`class-picker-panel ${position.upward ? 'class-picker-panel--up' : ''}`}
                        style={{ left: position.left, top: position.top, bottom: position.bottom, width: position.width }}
                    >
                        {searchable && (
                            <label className="class-picker-search">
                                <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                                <input
                                    ref={searchRef}
                                    value={query}
                                    onChange={event => { setQuery(event.target.value); setActive(0); }}
                                    onKeyDown={onKeyDown}
                                    placeholder="搜索班级或教师"
                                    aria-label="搜索班级或教师"
                                    aria-controls={listId}
                                    aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
                                />
                            </label>
                        )}
                        <ul
                            ref={listRef}
                            id={listId}
                            role="listbox"
                            tabIndex={-1}
                            aria-label="班级"
                            aria-activedescendant={filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
                            onKeyDown={onKeyDown}
                            className="class-picker-list"
                            style={{ maxHeight: position.maxHeight - (searchable ? 52 : 0) }}
                        >
                            {filtered.length ? filtered.map((item, index) => {
                                const selected = String(item.id) === String(value);
                                return (
                                    <li
                                        key={item.id}
                                        id={`${listId}-${item.id}`}
                                        data-index={index}
                                        role="option"
                                        aria-selected={selected}
                                        onPointerEnter={() => setActive(index)}
                                        onClick={() => choose(item)}
                                        className={`class-picker-option ${index === active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="class-picker-option-name">{item.name}</span>
                                            {item.teacherUsername && item.teacherUsername !== item.name && (
                                                <span className="class-picker-option-meta">教师 {item.teacherUsername}</span>
                                            )}
                                        </span>
                                        {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                                    </li>
                                );
                            }) : <li className="class-picker-empty">没有匹配的班级</li>}
                        </ul>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
