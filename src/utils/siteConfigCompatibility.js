export function removeObsoleteSiteConfigFields(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.hasOwn(config, 'loginLogo')) {
        return config;
    }

    // Historical records used loginLogo. The current logo settings use separate fields.
    const currentConfig = { ...config };
    delete currentConfig.loginLogo;
    return currentConfig;
}
