import crypto from 'crypto';
import express from '../compat/express.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { publicConfig } from '../utils/configSecrets.js';
import {
    normalizeDatabaseConnections, testDeviceDatabaseConfig,
    getDeviceInformation,
    listAccountColumns, listAccountDatabases, listAccountTables,
    normalizeAccountManagementConfig,
    testAccountManagementApi
} from '../utils/accountManagementApi.js';
import {
    deleteAccountManagementConfigAndUnbind,
    readAccountManagementConfig, readAccountManagementConfigs, writeAccountManagementConfigs
} from '../utils/accountManagementStore.js';

const router = express.Router();
const AUTH_SECRET_FIELDS = ['signingSecret'];

const publicService = config => {
    const visible = publicConfig(config);
    delete visible.databaseConfigEnvelope;
    return {
        ...visible,
        // This endpoint is protected by both login and administrator checks. The
        // administrator explicitly needs to verify/copy the HMAC value used by
        // the Windows executor; the UI still masks it by default.
        signingSecret: config.signingSecret || '',
        databaseConnections: config.databaseConnections || null,
        deviceReady: Boolean(config.deviceId && config.publicKey && config.signingSecret),
        transport: config.endpointUrl ? new URL(config.endpointUrl).protocol.replace(':', '').toUpperCase() : null
    };
};

async function requiredService(apiId, { allowDisabled = false } = {}) {
    const config = await readAccountManagementConfig(String(apiId || ''));
    if (!config) throw Object.assign(new Error('请选择有效的账号管理 API'), { status: 404 });
    if (!allowDisabled && !config.enabled) throw Object.assign(new Error('所选账号管理 API 已停用'), { status: 409 });
    return config;
}

function mergeSecrets(previous, incoming) {
    const merged = { ...previous, ...incoming };
    if (incoming.clearCredentials) {
        for (const field of AUTH_SECRET_FIELDS) delete merged[field];
    } else {
        for (const field of AUTH_SECRET_FIELDS) {
            if (incoming[field] === '' || incoming[field] == null) merged[field] = previous?.[field] || '';
        }
    }
    delete merged.clearCredentials;
    return merged;
}

function mergeDatabasePasswords(previous, incoming) {
    const next = normalizeDatabaseConnections(incoming || {});
    for (const key of ['sqlServer', 'mySql']) {
        if (!next[key].Password && previous?.[key]?.Password) next[key].Password = previous[key].Password;
    }
    return next;
}

router.get('/databases', authMiddleware, adminOnly, async (req, res) => {
    try {
        const provider = String(req.query.provider || '').toLowerCase();
        const config = await requiredService(req.query.apiId);
        res.json({ success: true, apiId: config.id, provider, databases: await listAccountDatabases(config, provider) });
    } catch (error) { res.status(Number(error.statusCode || error.status) || 500).json({ error: error.message || '数据库列表读取失败' }); }
});

router.get('/tables', authMiddleware, adminOnly, async (req, res) => {
    try {
        const provider = String(req.query.provider || '').trim().toLowerCase();
        const databaseName = String(req.query.databaseName || '').trim();
        const config = await requiredService(req.query.apiId);
        res.json({ apiId: config.id, provider, databaseName, tables: await listAccountTables(config, provider, databaseName) });
    } catch (error) { res.status(Number(error.statusCode || error.status) || 500).json({ error: error.message || '数据表列表读取失败', code: error.code || 'table_list_failed', requestId: error.requestId || null }); }
});

router.get('/columns', authMiddleware, adminOnly, async (req, res) => {
    try {
        const provider = String(req.query.provider || '').trim().toLowerCase();
        const databaseName = String(req.query.databaseName || '').trim();
        const accountTable = String(req.query.accountTable || '').trim();
        const config = await requiredService(req.query.apiId);
        res.json({ apiId: config.id, provider, databaseName, accountTable, columns: await listAccountColumns(config, provider, databaseName, accountTable) });
    } catch (error) { res.status(Number(error.statusCode || error.status) || 500).json({ error: error.message || '字段列表读取失败', code: error.code || 'column_list_failed', requestId: error.requestId || null }); }
});

router.get('/services', authMiddleware, adminOnly, async (_req, res) => {
    try { res.json({ services: (await readAccountManagementConfigs()).map(publicService) }); }
    catch (error) { res.status(500).json({ error: error.message || '读取账号管理 API 配置失败' }); }
});

router.post('/services', authMiddleware, adminOnly, async (req, res) => {
    try {
        const services = await readAccountManagementConfigs();
        const config = normalizeAccountManagementConfig({ ...req.body, id: crypto.randomUUID() });
        await writeAccountManagementConfigs([...services, config]);
        res.status(201).json({ success: true, config: publicService(config) });
    } catch (error) { res.status(400).json({ error: error.message || '新增账号管理 API 失败' }); }
});

router.post('/services/:id/database-config/test', authMiddleware, adminOnly, async (req, res) => {
    try {
        const config = await requiredService(req.params.id, { allowDisabled: true });
        if (!config.deviceId || !config.publicKey || !config.signingSecret) {
            return res.status(409).json({ error: '请先完成 API 连接检测并读取 Windows 执行端公钥' });
        }
        const connections = mergeDatabasePasswords(config.databaseConnections, req.body?.connections);
        const result = await testDeviceDatabaseConfig({ ...config, enabled: true }, connections);
        res.json({ success: true, result });
    } catch (error) {
        res.status(Number(error.statusCode || error.status) || 503).json({ error: error.message || '数据库连接测试失败', requestId: error.requestId || null });
    }
});

router.put('/services/:id/database-config', authMiddleware, adminOnly, async (req, res) => {
    try {
        const services = await readAccountManagementConfigs();
        const index = services.findIndex(item => item.id === req.params.id);
        if (index < 0) return res.status(404).json({ error: '账号管理 API 不存在' });
        const config = services[index];
        const connections = mergeDatabasePasswords(config.databaseConnections, req.body?.connections);
        const version = Math.max(Number(config.databaseConfigVersion) || 0, Math.floor(Date.now() / 1000)) + 1;
        services[index] = normalizeAccountManagementConfig({
            ...config,
            databaseConnections: connections,
            databaseConfigEnvelope: null,
            databaseConfigVersion: version,
            databaseConfigAppliedAt: new Date().toISOString(),
            databaseConfigLastError: ''
        });
        await writeAccountManagementConfigs(services);
        res.json({ success: true, config: publicService(services[index]) });
    } catch (error) {
        res.status(Number(error.statusCode || error.status) || 400).json({ error: error.message || '数据库连接信息保存失败', requestId: error.requestId || null });
    }
});

router.put('/services/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const services = await readAccountManagementConfigs();
        const index = services.findIndex(item => item.id === req.params.id);
        if (index < 0) return res.status(404).json({ error: '账号管理 API 不存在' });
        const config = normalizeAccountManagementConfig({ ...mergeSecrets(services[index], req.body || {}), id: services[index].id });
        services[index] = config;
        await writeAccountManagementConfigs(services);
        res.json({ success: true, config: publicService(config) });
    } catch (error) { res.status(400).json({ error: error.message || '保存账号管理 API 配置失败' }); }
});

router.delete('/services/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const services = await readAccountManagementConfigs();
        const next = services.filter(item => item.id !== req.params.id);
        if (next.length === services.length) return res.status(404).json({ error: '账号管理 API 不存在' });
        const unboundCompetitionCount = await deleteAccountManagementConfigAndUnbind(req.params.id, next);
        res.json({ success: true, unboundCompetitionCount });
    } catch (error) { res.status(500).json({ error: error.message || '删除账号管理 API 失败' }); }
});

router.post('/services/:id/test', authMiddleware, adminOnly, async (req, res) => {
    const startedAt = Date.now();
    let services = [];
    let index = -1;
    let config;
    let device;
    try {
        services = await readAccountManagementConfigs();
        index = services.findIndex(item => item.id === req.params.id);
        if (index < 0) return res.status(404).json({ error: '账号管理 API 不存在' });
        config = normalizeAccountManagementConfig({ ...mergeSecrets(services[index], req.body || {}), id: services[index].id, enabled: true }, { requireEndpoint: true });
        device = await getDeviceInformation(config);
        const result = await testAccountManagementApi(config);
        const connections = mergeDatabasePasswords(services[index].databaseConnections, req.body?.connections);
        const enabledProviders = [
            ...(connections.sqlServer?.Enabled ? ['sqlServer'] : []),
            ...(connections.mySql?.Enabled ? ['mySql'] : [])
        ];
        const databaseTest = enabledProviders.length
            ? await testDeviceDatabaseConfig({ ...config, ...device, enabled: true }, connections)
            : null;
        const identityChanged = Boolean(services[index].deviceId && services[index].deviceId !== device.deviceId);
        services[index] = normalizeAccountManagementConfig({
            ...config,
            ...device,
            enabled: services[index].enabled,
            ...(identityChanged ? {
                databaseConfigEnvelope: null,
                databaseConfigVersion: 0,
                databaseConfigAppliedAt: null,
                databaseConfigLastError: ''
            } : {}),
            lastTestAt: new Date().toISOString(),
            lastTestOk: true,
            lastLatencyMs: result.latencyMs,
            lastStatusCode: result.statusCode,
            lastError: ''
        });
        await writeAccountManagementConfigs(services);
        res.json({
            ...result,
            deviceReady: true,
            deviceId: device.deviceId,
            databaseTest,
            checkedProviders: enabledProviders
        });
    } catch (error) {
        if (config && index >= 0) {
            services[index] = normalizeAccountManagementConfig({ ...config, ...(device || {}), enabled: services[index].enabled, lastTestAt: new Date().toISOString(), lastTestOk: false, lastLatencyMs: error.latencyMs ?? (Date.now() - startedAt), lastStatusCode: error.statusCode ?? null, lastError: error.message || '连接失败' });
            try { await writeAccountManagementConfigs(services); } catch {}
        }
        res.status(503).json({ success: false, error: error.message || '账号管理 API 连接失败' });
    }
});

export default router;
