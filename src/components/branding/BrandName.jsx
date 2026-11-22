import React, { useState } from 'react';
import { getBrandImageCenterOffset } from '../../utils/brandImageAlignment';
import { BRAND_NAME } from '../../constants/brand';
import BrandWordmark from './BrandWordmark';

// An uploaded brand image wins; otherwise the built-in vector wordmark is
// used for the default name, and any other name is shown as text.
export default function BrandName({ name, imageUrl, className = '', onDark = false }) {
    const [failedUrl, setFailedUrl] = useState(null);
    const [alignment, setAlignment] = useState(null);

    if (!imageUrl || imageUrl === failedUrl) {
        if (String(name || '').trim().toLowerCase() === BRAND_NAME) {
            return <BrandWordmark label={name} onDark={onDark} />;
        }
        return <span className={className}>{name}</span>;
    }

    const offset = alignment?.imageUrl === imageUrl ? alignment.offset : 0;
    const alignImage = ({ currentTarget: image }) => {
        if (new URL(image.currentSrc || image.src).origin !== window.location.origin) return;
        setAlignment({ imageUrl, offset: getBrandImageCenterOffset(image) });
    };

    return (
        <img
            className="brand-name-image"
            src={imageUrl}
            alt={name}
            draggable="false"
            style={offset ? { transform: `translateY(${offset}%)` } : undefined}
            onLoad={alignImage}
            onError={() => setFailedUrl(imageUrl)}
        />
    );
}
