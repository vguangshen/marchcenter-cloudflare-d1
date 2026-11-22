import React, { useState } from 'react';
import { getBrandImageCenterOffset } from '../../utils/brandImageAlignment';

export default function BrandName({ name, imageUrl, className = '' }) {
    const [failedUrl, setFailedUrl] = useState(null);
    const [alignment, setAlignment] = useState(null);

    if (!imageUrl || imageUrl === failedUrl) {
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
