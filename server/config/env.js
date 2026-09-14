import { getEnv } from './runtime.js';

export function getJwtSecret() {
    const configuredSecret = getEnv('JWT_SECRET');
    if (!configuredSecret && getEnv('NODE_ENV') === 'production') {
        throw new Error('JWT_SECRET 未配置，请先使用 wrangler secret put JWT_SECRET');
    }
    return configuredSecret || 'marchcenter-local-development-secret';
}
