import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { THEMES } from '../../../constants/themes';
import { prefersReducedMotion } from '../../../utils/motionPreferences';
import AccentRaceScene from '../../branding/AccentRaceScene';

const THEME_OPTIONS = Object.entries(THEMES);
const DRAG_THRESHOLD = 6;
const SCROLL_SETTLE_MS = 160;

function horizontalCenter(element) {
    const { left, width } = element.getBoundingClientRect();
    return left + width / 2;
}

function findClosestTheme(viewport) {
    if (!viewport?.clientWidth) return null;
    const center = horizontalCenter(viewport);
    let closest;
    let distance = Infinity;
    for (const slide of viewport.querySelectorAll('.theme-carousel-slide')) {
        const nextDistance = Math.abs(horizontalCenter(slide) - center);
        if (nextDistance < distance) {
            distance = nextDistance;
            closest = slide.dataset.themeKey;
        }
    }
    return closest;
}

export default function ThemeCarousel({ value, dark, onChange }) {
    const confirmed = Object.hasOwn(THEMES, value) ? value : 'blue';
    const [selected, setSelected] = useState(confirmed);
    const [saving, setSaving] = useState(false);
    const headingId = useId();
    const viewportRef = useRef(null);
    const active = useRef(false);
    const lastSaved = useRef(confirmed);
    const wanted = useRef(confirmed);
    const saveInFlight = useRef(false);
    const save = useRef(onChange);
    const nativeScroll = useRef(false);
    const touching = useRef(false);
    const scrollTimer = useRef(0);
    const mouseDrag = useRef(null);
    const suppressClick = useRef(false);

    const centerTheme = useCallback((key, animate = false) => {
        nativeScroll.current = false;
        window.clearTimeout(scrollTimer.current);
        const viewport = viewportRef.current;
        const slide = viewport?.querySelector(`[data-theme-key="${key}"]`);
        if (!viewport?.clientWidth || !slide) return;

        const distance = horizontalCenter(slide) - horizontalCenter(viewport);
        if (Math.abs(distance) < 1) return;
        viewport.scrollTo({
            left: viewport.scrollLeft + distance,
            behavior: animate && !prefersReducedMotion() ? 'smooth' : 'instant'
        });
    }, []);

    useLayoutEffect(() => {
        active.current = true;
        const viewport = viewportRef.current;
        const observer = new ResizeObserver(() => {
            if (!nativeScroll.current && !mouseDrag.current?.moved) centerTheme(wanted.current);
        });
        observer.observe(viewport);
        return () => {
            active.current = false;
            observer.disconnect();
            window.clearTimeout(scrollTimer.current);
        };
    }, [centerTheme]);

    useLayoutEffect(() => {
        save.current = onChange;
    }, [onChange]);

    useLayoutEffect(() => {
        lastSaved.current = confirmed;
        if (saveInFlight.current) return;
        wanted.current = confirmed;
        setSelected(confirmed);
        centerTheme(confirmed);
    }, [centerTheme, confirmed]);

    const saveSelection = async () => {
        if (saveInFlight.current || wanted.current === lastSaved.current) return;
        saveInFlight.current = true;
        setSaving(true);

        // Keep the most recent choice while a request is pending.
        while (active.current && wanted.current !== lastSaved.current) {
            const key = wanted.current;
            let saved = false;
            try { saved = await save.current(key); }
            catch { /* Restore the last confirmed theme if the save throws. */ }
            if (!active.current) break;
            if (saved) {
                lastSaved.current = key;
            } else if (wanted.current === key) {
                wanted.current = lastSaved.current;
                setSelected(lastSaved.current);
                centerTheme(lastSaved.current, true);
            }
        }

        saveInFlight.current = false;
        if (active.current) setSaving(false);
    };

    const chooseTheme = key => {
        wanted.current = key;
        setSelected(key);
        centerTheme(key, true);
        void saveSelection();
    };

    const settleScroll = () => {
        window.clearTimeout(scrollTimer.current);
        if (touching.current || mouseDrag.current?.moved) return;
        if (!nativeScroll.current) {
            // A focus or resize during smooth scrolling can interrupt the final snap.
            centerTheme(wanted.current);
            return;
        }
        nativeScroll.current = false;
        const closest = findClosestTheme(viewportRef.current);
        if (closest) chooseTheme(closest);
    };

    const waitForScroll = () => {
        if (touching.current || mouseDrag.current?.moved) return;
        window.clearTimeout(scrollTimer.current);
        scrollTimer.current = window.setTimeout(settleScroll, SCROLL_SETTLE_MS);
    };

    const finishTouch = event => {
        if (event.touches.length) return;
        touching.current = false;
        waitForScroll();
    };

    const startDrag = event => {
        if (event.pointerType !== 'mouse') {
            nativeScroll.current = true;
            return;
        }
        if (event.button !== 0) return;
        nativeScroll.current = false;
        suppressClick.current = false;
        mouseDrag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
    };

    const moveDrag = event => {
        const drag = mouseDrag.current;
        if (!drag || drag.id !== event.pointerId) return;
        const delta = drag.x - event.clientX;
        const viewport = event.currentTarget;
        if (!drag.moved) {
            if (Math.abs(delta) < DRAG_THRESHOLD) return;
            drag.moved = true;
            viewport.setPointerCapture(event.pointerId);
            viewport.dataset.dragging = 'true';
            viewport.style.scrollSnapType = 'none';
        }
        event.preventDefault();
        viewport.scrollTo({ left: drag.left + delta, behavior: 'instant' });
    };

    const finishDrag = event => {
        const drag = mouseDrag.current;
        if (!drag || drag.id !== event.pointerId) return;
        mouseDrag.current = null;
        if (!drag.moved) return;

        const viewport = event.currentTarget;
        const closest = findClosestTheme(viewport);
        delete viewport.dataset.dragging;
        viewport.style.removeProperty('scroll-snap-type');
        suppressClick.current = true;
        if (closest) chooseTheme(closest);
    };

    const moveSelection = (direction, focusSlide = false) => {
        const index = THEME_OPTIONS.findIndex(([key]) => key === wanted.current);
        const next = THEME_OPTIONS[index + direction]?.[0];
        if (!next) return;
        chooseTheme(next);
        if (focusSlide) viewportRef.current?.querySelector(`[data-theme-key="${next}"]`)?.focus({ preventScroll: true });
    };

    const handleKeyDown = event => {
        if (event.altKey || event.metaKey || event.ctrlKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        moveSelection(event.key === 'ArrowLeft' ? -1 : 1, event.target.classList.contains('theme-carousel-slide'));
    };

    return (
        <section className="theme-carousel" aria-labelledby={headingId} onKeyDown={handleKeyDown}>
            <div className="theme-carousel-heading">
                <div>
                    <h3 id={headingId}>主题色</h3>
                    <p>横向滑动，停稳后应用</p>
                </div>
                <span className="theme-carousel-status" role="status">{saving ? '正在保存…' : ''}</span>
            </div>
            <div
                ref={viewportRef}
                className="theme-carousel-viewport"
                onScroll={waitForScroll}
                onScrollEnd={settleScroll}
                onWheel={event => {
                    if (event.deltaX || (event.shiftKey && event.deltaY)) nativeScroll.current = true;
                }}
                onTouchStart={() => {
                    touching.current = true;
                    window.clearTimeout(scrollTimer.current);
                }}
                onTouchEnd={finishTouch}
                onTouchCancel={finishTouch}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onLostPointerCapture={finishDrag}
                onPointerLeave={() => {
                    if (!mouseDrag.current?.moved) mouseDrag.current = null;
                }}
                onDragStart={event => event.preventDefault()}
                onClickCapture={event => {
                    if (suppressClick.current && event.detail) {
                        suppressClick.current = false;
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }}
            >
                <div className="theme-carousel-rail">
                    {THEME_OPTIONS.map(([key, theme]) => (
                        <button
                            key={key}
                            type="button"
                            className={`theme-carousel-slide${selected === key ? ' is-active' : ''}`}
                            data-theme-key={key}
                            aria-pressed={selected === key}
                            tabIndex={selected === key ? 0 : -1}
                            style={{ '--system-accent-rgb': theme.rgb }}
                            onClick={() => chooseTheme(key)}
                        >
                            <AccentRaceScene className="theme-carousel-art" dark={dark} />
                            <span className="theme-carousel-card-label">{theme.label}</span>
                        </button>
                    ))}
                </div>
            </div>
            <div className="theme-carousel-controls">
                <button type="button" className="theme-carousel-arrow" aria-label="上一种主题色" disabled={selected === THEME_OPTIONS[0][0]} onClick={() => moveSelection(-1)}>
                    <ChevronLeft aria-hidden="true" />
                </button>
                <div className="theme-carousel-swatches" role="group" aria-label="主题色选项">
                    {THEME_OPTIONS.map(([key, theme]) => (
                        <button
                            key={key}
                            type="button"
                            className={`theme-carousel-swatch${selected === key ? ' is-active' : ''}`}
                            data-theme-key={key}
                            aria-label={`选择${theme.label}`}
                            aria-pressed={selected === key}
                            title={theme.label}
                            style={{ '--system-accent-rgb': theme.rgb }}
                            onClick={() => chooseTheme(key)}
                        />
                    ))}
                </div>
                <button type="button" className="theme-carousel-arrow" aria-label="下一种主题色" disabled={selected === THEME_OPTIONS.at(-1)[0]} onClick={() => moveSelection(1)}>
                    <ChevronRight aria-hidden="true" />
                </button>
            </div>
        </section>
    );
}
