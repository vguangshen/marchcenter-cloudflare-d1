import { normalizeBrandText } from '../constants/brand.js';

const COPY_FIELD = /(?:Title|Subtitle|Name|Label|Placeholder|Text|Hint|Lead|Instruction|Quote)$/;

export function normalizeStoredSiteConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return config;

    let currentConfig = config;
    if (Object.hasOwn(config, 'loginLogo')) {
        // Historical records used loginLogo. The current logo settings use separate fields.
        currentConfig = { ...config };
        delete currentConfig.loginLogo;
    }

    for (const [key, value] of Object.entries(config)) {
        if (!COPY_FIELD.test(key)) continue;
        const hasRichText = typeof value?.text === 'string';
        const text = hasRichText ? value.text : value;
        const brandedText = normalizeBrandText(text);
        if (brandedText === text) continue;

        if (currentConfig === config) currentConfig = { ...config };
        currentConfig[key] = hasRichText ? { ...value, text: brandedText } : brandedText;
    }
    return currentConfig;
}
