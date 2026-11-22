import React, { useState } from 'react';

export default function BrandName({ name, imageUrl, className = '' }) {
    const [failedUrl, setFailedUrl] = useState(null);

    if (!imageUrl || imageUrl === failedUrl) {
        return <span className={className}>{name}</span>;
    }

    return (
        <img
            className="brand-name-image"
            src={imageUrl}
            alt={name}
            draggable="false"
            onError={() => setFailedUrl(imageUrl)}
        />
    );
}
