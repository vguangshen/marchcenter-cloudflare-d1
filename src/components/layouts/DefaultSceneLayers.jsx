import React, { useEffect, useMemo, useRef, useState } from 'react';
import dawnSource from '../../../public/default-scene/competition-dawn.svg?raw';
import nightSource from '../../../public/default-scene/competition-night.svg?raw';

// The default "competition skyline" is drawn as six stacked depth layers so
// each can make its own entrance. Every layer is an <img> of a standalone SVG
// (keeps object-fit framing and isolates the SVG ids); the browser rasterises
// each once and the intro only animates transform/opacity on those layers.
const SOURCES = { dawn: dawnSource, night: nightSource };
export const SCENE_LAYERS = ['sky', 'far', 'mid', 'campus', 'front', 'details'];
const INTRO_DURATION_MS = 2300;

const layerCache = new Map();
function sceneLayers(mode) {
    if (layerCache.has(mode)) return layerCache.get(mode);
    const svg = new DOMParser().parseFromString(SOURCES[mode], 'image/svg+xml').documentElement;
    const serializer = new XMLSerializer();
    const defs = serializer.serializeToString(svg.querySelector('defs'));
    const layers = SCENE_LAYERS.map(name => {
        const group = svg.querySelector(`g[data-layer="${name}"]`);
        const source = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">${defs}${serializer.serializeToString(group)}</svg>`;
        return { name, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` };
    });
    layerCache.set(mode, layers);
    return layers;
}

// The intro plays once per page load. A remount part-way through (login →
// dashboard swaps the background) resumes it from the same point.
let introStartedAt = null;
function introProgress() {
    if (introStartedAt === null) return null;
    const elapsed = performance.now() - introStartedAt;
    return elapsed < INTRO_DURATION_MS ? elapsed : Infinity;
}

export default function DefaultSceneLayers({ dark, animate }) {
    const mode = dark ? 'night' : 'dawn';
    const layers = useMemo(() => sceneLayers(mode), [mode]);
    const rootRef = useRef(null);
    const [state, setState] = useState(() => {
        const elapsed = introProgress();
        if (!animate || elapsed === Infinity) return { phase: 'static', offset: 0 };
        if (elapsed !== null) return { phase: 'playing', offset: elapsed };
        return { phase: 'waiting', offset: 0 };
    });

    // Start only once every layer is decoded, so nothing pops in mid-intro.
    useEffect(() => {
        if (state.phase !== 'waiting') return undefined;
        let cancelled = false;
        const images = [...rootRef.current.querySelectorAll('img')];
        Promise.all(images.map(image => image.decode().catch(() => {}))).then(() => {
            if (cancelled) return;
            requestAnimationFrame(() => {
                if (cancelled) return;
                introStartedAt = performance.now();
                setState({ phase: 'playing', offset: 0 });
            });
        });
        return () => { cancelled = true; };
    }, [state.phase]);

    // Drop the compositor hints once the intro is over.
    useEffect(() => {
        if (state.phase !== 'playing') return undefined;
        const timer = window.setTimeout(() => setState({ phase: 'static', offset: 0 }), INTRO_DURATION_MS - state.offset + 50);
        return () => window.clearTimeout(timer);
    }, [state]);

    return (
        <div
            ref={rootRef}
            aria-hidden="true"
            data-scene-mode={mode}
            className={`default-scene default-scene--${state.phase}`}
            style={state.offset ? { '--scene-offset': `-${Math.round(state.offset)}ms` } : undefined}
        >
            {layers.map(layer => (
                <img
                    key={layer.name}
                    src={layer.url}
                    alt=""
                    draggable="false"
                    decoding="async"
                    className={`default-scene-layer default-scene-layer--${layer.name}`}
                />
            ))}
        </div>
    );
}
