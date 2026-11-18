import pool from '../config/db.js';
import { getEnv } from '../config/runtime.js';
import { decodeStoredConfig } from './configSecrets.js';

export function parseSsoConfig(record) {
    try {
        return decodeStoredConfig(record.config_data || {});
    } catch {
        return {};
    }
}

export async function readDefaultSsoConfigs() {
    const [rows] = await pool.query('SELECT * FROM sso_configs ORDER BY id DESC');
    const configs = new Map();
    for (const record of rows) {
        const config = parseSsoConfig(record);
        if (config.method && config.canaryOnly !== true && !configs.has(config.method)) {
            configs.set(config.method, { record, config });
        }
    }
    return configs;
}

export function defaultSsoAllowsHttp(config) {
    return config ? Boolean(config.allowHttp) : getEnv('ALLOW_HTTP_PLATFORMS') === 'true';
}
