import React, { useId } from 'react';
import { WORDMARK_CENTER_OFFSET, WORDMARK_PARTS, WORDMARK_VIEWBOX } from './brandWordmarkPaths';

/**
 * The mcgo.app wordmark as vector outlines (traced from the uploaded logo).
 * Each part ("mc", "go", ".app") has its own gradient whose colours come from
 * CSS, so the dark "mc" turns light in dark mode or on dark navbars.
 */
export default function BrandWordmark({ label, onDark = false, className = '' }) {
    const id = useId().replace(/:/g, '');
    return (
        <svg
            className={`brand-wordmark ${onDark ? 'brand-wordmark--on-dark' : ''} ${className}`}
            viewBox={WORDMARK_VIEWBOX}
            role="img"
            aria-label={label}
            style={{ transform: `translateY(${WORDMARK_CENTER_OFFSET}%)` }}
        >
            <defs>
                {WORDMARK_PARTS.map(part => (
                    <linearGradient key={part.id} id={`${id}-${part.id}`} x1="0" x2="0" y1={part.y1} y2={part.y2} gradientUnits="userSpaceOnUse">
                        <stop className={`brand-wordmark-stop brand-wordmark-stop--${part.id}-top`} />
                        <stop offset="1" className={`brand-wordmark-stop brand-wordmark-stop--${part.id}-bottom`} />
                    </linearGradient>
                ))}
            </defs>
            {WORDMARK_PARTS.map(part => (
                <g key={part.id} className={`brand-wordmark-part brand-wordmark-part--${part.id}`}>
                    <path fill={`url(#${id}-${part.id})`} fillRule="evenodd" d={part.d} />
                </g>
            ))}
        </svg>
    );
}
