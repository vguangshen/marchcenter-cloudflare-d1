import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { splitSvgLayers, useSceneIntro } from './layeredScene';
import { apiFetch } from '../../utils/api';

// Text of an SVG served from /public, fetched once per URL through the shared
// transport (timeouts and retries; no credentials leave for non-API paths).
const sourceRequests = new Map();
function loadSource(url) {
    if (!sourceRequests.has(url)) {
        sourceRequests.set(url, apiFetch(new URL(url, window.location.origin).href).then(response => {
            if (!response.ok) throw new Error(`Scene ${url} returned ${response.status}`);
            return response.text();
        }).catch(error => {
            sourceRequests.delete(url);
            throw error;
        }));
    }
    return sourceRequests.get(url);
}

/**
 * A vector scene drawn as stacked depth layers that make a staggered entrance.
 * Pass `source` (SVG text bundled with the app) or `url` (fetched on demand).
 * Each layer is an <img> so the browser rasterises it once and the entrance
 * only animates transform/opacity on those images.
 */
export default function LayeredSvgScene({ sceneKey, source = null, url = null, animate, focusY = '50%', variant = '' }) {
    const [fetched, setFetched] = useState(null);
    useEffect(() => {
        if (source || !url) return undefined;
        let cancelled = false;
        loadSource(url).then(text => { if (!cancelled) setFetched({ url, text }); }, () => {});
        return () => { cancelled = true; };
    }, [source, url]);
    const text = source || (fetched?.url === url ? fetched.text : null);
    const layers = useMemo(() => (text ? splitSvgLayers(text) : []), [text]);

    const rootRef = useRef(null);
    const ready = useCallback(() => Promise.all(
        [...rootRef.current.querySelectorAll('img')].map(image => image.decode().catch(() => {}))
    ), []);
    const { rootProps } = useSceneIntro(sceneKey, animate, layers.length ? ready : null);

    return (
        <div
            ref={rootRef}
            aria-hidden="true"
            data-scene={sceneKey}
            data-scene-variant={variant || undefined}
            {...rootProps}
            style={{ ...rootProps.style, '--scene-focus-y': focusY }}
        >
            {layers.map((layer, index) => (
                <img
                    key={`${index}-${layer.role}`}
                    src={layer.url}
                    alt=""
                    draggable="false"
                    decoding="async"
                    className={`layered-scene-layer layered-scene-layer--${layer.role}`}
                />
            ))}
        </div>
    );
}
