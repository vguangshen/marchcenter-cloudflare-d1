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

export async function readAccountManagementConfigs() {
    const [[row]] = await pool.query(
        'SELECT config_value FROM system_configs WHERE config_key = ? LIMIT 1',
        [CONFIG_KEY]
    );
    if (!row) return [];
    const raw = typeof row.config_value === 'string' ? JSON.parse(row.config_value || '{}') : row.config_value;
    if (raw?.version !== 2 || !Array.isArray(raw.services)) return [];
    return raw.services.map(item => normalizeAccountManagementConfig(decodeStoredConfig(item)));
}

export async function writeAccountManagementConfigs(configs) {
    await pool.query(
        `INSERT INTO system_configs (config_key, config_value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = CURRENT_TIMESTAMP`,
        [CONFIG_KEY, serializeConfigs(configs)]
    );
}

export async function deleteAccountManagementConfigAndUnbind(id, configs) {
    const [[usage]] = await pool.query(
        'SELECT COUNT(*) AS count FROM competitions WHERE account_api_id = ?',
        [id]
    );
    await pool.batch([
        [
            `UPDATE competitions
             SET account_api_id = NULL,
                 account_db_provider = NULL,
                 account_db_name = NULL,
                 account_table_name = NULL,
                 account_username_column = NULL,
                 account_password_column = NULL,
                 account_password_algorithm = NULL,
                 restore_original_password_before_sso = 0,
                 restore_original_password_ciphertext = NULL
             WHERE account_api_id = ?`,
            [id]
        ],
        [
            `INSERT INTO system_configs (config_key, config_value, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = CURRENT_TIMESTAMP`,
            [CONFIG_KEY, serializeConfigs(configs)]
        ]
    ]);
    return Number(usage?.count || 0);
}

export async function readAccountManagementConfig(id = '') {
    const configs = await readAccountManagementConfigs();
    if (id) return configs.find(item => item.id === id) || null;
    return configs.find(item => item.enabled) || configs[0] || null;
}

export async function writeAccountManagementConfig(config) {
    return writeAccountManagementConfigs([config]);
}
