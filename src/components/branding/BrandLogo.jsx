import React from 'react';
import {
    Globe2, Hexagon, Rocket, ShieldCheck, Star, Trophy, Zap
} from 'lucide-react';

export const BRAND_LOGO_PRESETS = [
    { id: 'Trophy', label: '奖杯', icon: Trophy },
    { id: 'ShieldCheck', label: '安全', icon: ShieldCheck },
    { id: 'Zap', label: '闪电', icon: Zap },
    { id: 'Globe', label: '全球', icon: Globe2 },
    { id: 'Rocket', label: '火箭', icon: Rocket },
    { id: 'Star', label: '星标', icon: Star },
    { id: 'Hexagon', label: '六边形', icon: Hexagon }
];

const BRAND_LOGO_ICON_MAP = Object.fromEntries(
    BRAND_LOGO_PRESETS.map(item => [item.id, item.icon])
);

// A custom image can opt out of the theme-coloured tile so a full-colour logo
// is shown as-is. Preset icons are white glyphs and always keep the tile.
export function brandLogoHasTile(config) {
    return !(config?.navbarLogoType === 'custom' && config?.navbarLogoUrl && config?.navbarLogoBackground === 'none');
}

const BrandLogo = ({ type = 'Trophy', url = '', className = '', imageClassName = '' }) => {
    if (type === 'custom' && url) {
        return <img src={url} alt="" draggable="false" className={imageClassName || className} />;
    }
    const Icon = BRAND_LOGO_ICON_MAP[type] || Trophy;
    return <Icon className={className} aria-hidden="true" />;
};

export default BrandLogo;
