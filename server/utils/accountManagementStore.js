import pool from '../config/db.js';
import { decodeStoredConfig, encodeStoredConfig } from './configSecrets.js';
import { normalizeAccountManagementConfig } from './accountManagementApi.js';

const CONFIG_KEY = 'account_management_api';

function serializeConfigs(configs) {
    return JSON.stringify({
        version: 2,
        services: configs.map(config => encodeStoredConfig(config))
    });
}

async function readStoredValue() {
    const [[row]] = await pool.query(
        'SELECT config_value FROM system_configs WHERE config_key = ? LIMIT 1',
        [CONFIG_KEY]
    );
    return row?.config_value ?? null;
}

function decodeConfigs(value) {
    if (value === null) return [];
    const raw = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    if (raw?.version !== 2 || !Array.isArray(raw.services)) return [];
    return raw.services.map(item => normalizeAccountManagementConfig(decodeStoredConfig(item)));
}

export async function readAccountManagementConfigs({ tolerateMalformed = false } = {}) {
    const value = await readStoredValue();
    try {
        return decodeConfigs(value);
    } catch (error) {
        if (tolerateMalformed) return [];
        throw error;
    }
}

// Services share a legacy JSON row. Retry local edits against its exact stored value
// so operations on different services can commit without replacing one another.
export async function updateAccountManagementConfig(id, revise, { create = false } = {}) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const previous = await readStoredValue();
        const configs = decodeConfigs(previous);
        const index = configs.findIndex(config => config.id === id);
        if (index < 0 && !create) throw Object.assign(new Error('账号管理 API 不存在'), { status: 404 });
        const config = revise(configs[index]);
        const statements = [];
        if (config === null) {
            configs.splice(index, 1);
            statements.push([`UPDATE competitions
             SET account_api_id = NULL,
                 account_db_provider = NULL,
                 account_db_name = NULL,
                 account_table_name = NULL,
                 account_username_column = NULL,
                 account_password_column = NULL,
                 account_password_algorithm = NULL,
                 restore_original_password_before_sso = 0,
                 restore_original_password_ciphertext = NULL
             WHERE account_api_id = ?
               AND EXISTS (SELECT 1 FROM system_configs WHERE config_key = ? AND config_value IS ?)`,
                [id, CONFIG_KEY, previous]]);
        } else if (index < 0) {
            configs.push(config);
        } else {
            configs[index] = config;
        }
        statements.push([
            `INSERT INTO system_configs (config_key, config_value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = CURRENT_TIMESTAMP
             WHERE system_configs.config_value IS ?`,
            [CONFIG_KEY, serializeConfigs(configs), previous]
        ]);
        const results = await pool.batch(statements);
        if (results.at(-1).affectedRows) return config ?? results[0].affectedRows;
    }
    throw Object.assign(new Error('服务配置正在更新，请重试'), { status: 409 });
}

export function deleteAccountManagementConfigAndUnbind(id) {
    return updateAccountManagementConfig(id, () => null);
}

export function selectAccountManagementConfig(configs, id = '') {
    if (id) return configs.find(item => item.id === id) || null;
    return configs.find(item => item.enabled) || configs[0] || null;
}

export async function readAccountManagementConfig(id = '') {
    return selectAccountManagementConfig(await readAccountManagementConfigs(), id);
}
