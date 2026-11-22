import { useEffect, useState } from 'react';

// Shared machinery for the layered scene entrances (default skyline, holiday
// scenes, theme-colour track). Scenes are split into depth layers that share
// a small set of roles; CSS gives each role its own entrance.
export const SCENE_ROLES = ['sky', 'celestial', 'far', 'mid', 'focal', 'front', 'track', 'details'];
export const SCENE_INTRO_MS = 2300;

// Each scene plays once per page load. A remount part-way through (login →
// dashboard swaps the background) resumes from the same point.
const introStarts = new Map();
function introElapsed(sceneKey) {
    if (!introStarts.has(sceneKey)) return null;
    const elapsed = performance.now() - introStarts.get(sceneKey);
    return elapsed < SCENE_INTRO_MS ? elapsed : Infinity;
}

/**
 * Returns the intro phase ('waiting' → 'playing' → 'static') and the root
 * props to spread on the scene container. `ready` resolves once every layer
 * can paint, so nothing pops in part-way through the entrance.
 */
export function useSceneIntro(sceneKey, animate, ready) {
    const [state, setState] = useState(() => {
        const elapsed = introElapsed(sceneKey);
        if (!animate || elapsed === Infinity) return { phase: 'static', offset: 0 };
        if (elapsed !== null) return { phase: 'playing', offset: elapsed };
        return { phase: 'waiting', offset: 0 };
    });

    useEffect(() => {
        if (state.phase !== 'waiting' || !ready) return undefined;
        let cancelled = false;
        Promise.resolve(ready()).catch(() => {}).then(() => {
            if (cancelled) return;
            requestAnimationFrame(() => {
                if (cancelled) return;
                introStarts.set(sceneKey, performance.now());
                setState({ phase: 'playing', offset: 0 });
            });
        });
        return () => { cancelled = true; };
    }, [state.phase, ready, sceneKey]);

    // Drop the compositor hints once the entrance is over.
    useEffect(() => {
        if (state.phase !== 'playing') return undefined;
        const timer = window.setTimeout(() => setState({ phase: 'static', offset: 0 }), SCENE_INTRO_MS - state.offset + 50);
        return () => window.clearTimeout(timer);
    }, [state]);

    return {
        phase: state.phase,
        rootProps: {
            'data-scene-phase': state.phase,
            className: `layered-scene layered-scene--${state.phase}`,
            style: state.offset ? { '--scene-offset': `-${Math.round(state.offset)}ms` } : undefined
        }
    };
}

// Splits an SVG whose top-level <g data-layer="role"> groups mark its depth
// layers into standalone SVG data URLs, in document (paint) order. Each keeps
// the shared <defs>, so ids stay local to their own image.
const splitCache = new Map();
export function splitSvgLayers(source) {
    if (splitCache.has(source)) return splitCache.get(source);
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const serializer = new XMLSerializer();
    const defsNode = svg.querySelector('defs');
    const defs = defsNode ? serializer.serializeToString(defsNode) : '';
    const viewBox = svg.getAttribute('viewBox') || '0 0 1600 900';
    const [, , width, height] = viewBox.split(/[\s,]+/);
    const layers = [...svg.children]
        .filter(node => node.localName === 'g' && SCENE_ROLES.includes(node.getAttribute('data-layer')))
        .map(group => {
            const document = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">${defs}${serializer.serializeToString(group)}</svg>`;
            return {
                role: group.getAttribute('data-layer'),
                url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(document)}`
            };
        });
    splitCache.set(source, layers);
    return layers;
}
