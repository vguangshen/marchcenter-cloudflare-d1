import crypto from 'crypto';
import { safeHttpText } from './safeHttpClient.js';

const AUTH_MODES = new Set(['hmac']);

function normalizedEndpoint(value, required = false) {
    const text = String(value || '').trim();
    if (!text && !required) return '';
    let url;
    try { url = new URL(text); }
    catch { throw new Error('账号管理 API 地址格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('账号管理 API 仅支持 HTTP 或 HTTPS');
    if (url.username || url.password) throw new Error('API 地址中不能包含账号或密码');
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

function normalizedHealthPath(value) {
    const path = String(value || '/health').trim() || '/health';
    if (!path.startsWith('/') || path.includes('://')) throw new Error('健康检查路径必须以 / 开头');
    return path.slice(0, 200);
}

export function normalizeAccountManagementConfig(input = {}, { requireEndpoint = false } = {}) {
    const enabled = Boolean(input.enabled);
    const endpointUrl = normalizedEndpoint(input.endpointUrl, requireEndpoint || enabled);
    const authMode = AUTH_MODES.has(input.authMode) ? input.authMode : 'hmac';
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 10000, 2000), 30000);

    return {
        id: String(input.id || '').trim().slice(0, 80),
        name: String(input.name || '主账号服务').trim().slice(0, 80) || '主账号服务',
        enabled,
        endpointUrl,
        healthPath: normalizedHealthPath(input.healthPath),
        authMode,
        timeoutMs,
        signingSecret: String(input.signingSecret || ''),
        deviceId: String(input.deviceId || '').trim().slice(0, 100),
        publicKey: input.publicKey && typeof input.publicKey === 'object' ? input.publicKey : null,
        encryption: String(input.encryption || '').trim().slice(0, 40),
        databaseConfigVersion: Number.isFinite(Number(input.databaseConfigVersion)) ? Number(input.databaseConfigVersion) : 0,
        databaseConfigAppliedAt: input.databaseConfigAppliedAt || null,
        databaseConfigLastError: input.databaseConfigLastError ? String(input.databaseConfigLastError).slice(0, 500) : '',
        databaseConfigEnvelope: input.databaseConfigEnvelope && typeof input.databaseConfigEnvelope === 'object' ? input.databaseConfigEnvelope : null,
        databaseConnections: input.databaseConnections && typeof input.databaseConnections === 'object' ? input.databaseConnections : null,
        lastTestAt: input.lastTestAt || null,
        lastTestOk: input.lastTestOk === true,
        lastLatencyMs: Number.isFinite(Number(input.lastLatencyMs)) ? Number(input.lastLatencyMs) : null,
        lastStatusCode: Number.isFinite(Number(input.lastStatusCode)) ? Number(input.lastStatusCode) : null,
        lastError: input.lastError ? String(input.lastError).slice(0, 500) : ''
    };
}

const base64Url = value => Buffer.from(value).toString('base64url');

const classDeleteText = value => String(value || '').trim().slice(0, 120);

/**
 * JAVA 平台班级删除映射（卡片级）：让执行端按通用参数化 DELETE 删除平台数据库中的
 * 班级及其关联用户。open-API 删班在真实平台不可靠（YX030505 markGroupDeleted 302、
 * YT00123 checkClassName 硬编码 uc_mode=5 导致班级不可见），改用执行端直连数据库删。
 * 必填：apiId、databaseName、classTable、classNameColumn，以及用于同步删除学生/教师账号的
 * classIdColumn、userTable、userClassColumn。删除始终先清理关联账号，再删除班级行。
 */
export function normalizeClassDeleteMapping(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        enabled: Boolean(source.enabled),
        apiId: classDeleteText(source.apiId),
        databaseName: classDeleteText(source.databaseName),
        classTable: classDeleteText(source.classTable),
        classNameColumn: classDeleteText(source.classNameColumn),
        classIdColumn: classDeleteText(source.classIdColumn),
        userTable: classDeleteText(source.userTable),
        userClassColumn: classDeleteText(source.userClassColumn)
    };
}

export function isClassDeleteMappingReady(mapping = {}) {
    const value = mapping || {};
    return Boolean(
        value.enabled && value.apiId && value.databaseName && value.classTable && value.classNameColumn
        && value.classIdColumn && value.userTable && value.userClassColumn
    );
}

export function normalizeDatabaseConnections(input = {}) {
    const provider = (value = {}, defaults) => ({
        Enabled: Boolean(value.Enabled),
        Host: String(value.Host || '').trim().slice(0, 100) || 'localhost',
        Port: Math.min(Math.max(Number(value.Port) || defaults.port, 1), 65535),
        User: String(value.User || '').trim().slice(0, 80),
        Password: String(value.Password || '').slice(0, 200),
        InitialDatabase: String(value.InitialDatabase || defaults.database).trim().slice(0, 80) || defaults.database,
        IntegratedSecurity: Boolean(value.IntegratedSecurity),
        Encrypt: Boolean(value.Encrypt),
        TrustServerCertificate: value.TrustServerCertificate !== false,
        CharacterSet: String(value.CharacterSet || 'utf8mb4').trim().slice(0, 30) || 'utf8mb4',
        SslMode: ['None', 'Preferred', 'Required', 'VerifyCA', 'VerifyFull'].includes(value.SslMode) ? value.SslMode : 'None',
        CommandTimeoutSeconds: Math.min(Math.max(Number(value.CommandTimeoutSeconds) || 10, 2), 60)
    });
    return {
        sqlServer: provider(input.sqlServer, { port: 1433, database: 'master' }),
        mySql: provider(input.mySql, { port: 3306, database: 'mysql' })
    };
}

export async function createDatabaseConfigEnvelope(rawConfig, connections, version = Math.floor(Date.now() / 1000)) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    if (!config.deviceId || !config.publicKey) throw new Error('请先完成连接检测，读取 Windows 执行端设备公钥');
    // Cloudflare's Node compatibility layer can create a PublicKeyObject, but
    // publicEncrypt does not accept that object in every Workers runtime. Use
    // the platform-native Web Crypto implementation so the stored JWK is
    // imported and consumed by the same API.
    const subtle = globalThis.crypto?.subtle || crypto.webcrypto?.subtle;
    if (!subtle) throw new Error('当前运行环境不支持数据库配置加密');
    const publicKey = await subtle.importKey(
        'jwk',
        config.publicKey,
        { name: 'RSA-OAEP', hash: 'SHA-1' },
        false,
        ['encrypt']
    );
    const encoder = new TextEncoder();
    const encryptProvider = async value => base64Url(await subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        encoder.encode(JSON.stringify(value))
    ));
    const normalized = normalizeDatabaseConnections(connections);
    const [sqlServer, mySql] = await Promise.all([
        encryptProvider(normalized.sqlServer),
        encryptProvider(normalized.mySql)
    ]);
    return {
        deviceId: config.deviceId,
        version: Math.min(Math.max(Math.floor(Number(version)) || Math.floor(Date.now() / 1000), 1), Number.MAX_SAFE_INTEGER),
        algorithm: 'RSA-OAEP-SHA1',
        sqlServer,
        mySql
    };
}

export async function testDeviceDatabaseConfig(rawConfig, connections) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const envelope = await createDatabaseConfigEnvelope(config, connections);
    const { data } = await requestAccountManagementApi(config, '/api/v1/device/config/test', { method: 'POST', payload: envelope });
    if (data.success !== true) throw new Error('执行端未确认数据库连接测试通过');
    return data;
}

export async function applyDeviceDatabaseConfig(rawConfig, envelope) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const { data } = await requestAccountManagementApi(config, '/api/v1/device/config/apply', { method: 'POST', payload: envelope });
    if (data.success !== true) throw new Error('执行端未确认数据库配置已生效');
    return data;
}

export async function ensureDeviceDatabaseConfig(rawConfig) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    if (!config.databaseConnections) throw new Error('该 API 服务器尚未保存数据库连接信息');
    const version = Number(config.databaseConfigVersion) || Math.floor(Date.now() / 1000);
    return applyDeviceDatabaseConfig(config, await createDatabaseConfigEnvelope(config, config.databaseConnections, version));
}

export async function rollbackDeviceDatabaseConfig(rawConfig) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const { data } = await requestAccountManagementApi(config, '/api/v1/device/config/rollback', { method: 'POST', payload: {} });
    if (data.success !== true) throw new Error('执行端未确认配置回滚成功');
    return data;
}

function hmacHeaders(config, url, method = 'GET', body = '') {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomUUID();
    const requestTarget = `${url.pathname}${url.search}`;
    const payload = `${timestamp}\n${nonce}\n${method}\n${requestTarget}\n${body}`;
    const signature = crypto.createHmac('sha256', config.signingSecret).update(payload).digest('base64url');
    return {
        'X-MarchCenter-Timestamp': timestamp,
        'X-MarchCenter-Nonce': nonce,
        'X-MarchCenter-Signature': signature
    };
}

function authenticationHeaders(config, url, method = 'GET', body = '') {
    // 执行端桥梁只支持 HMAC 请求签名。
    if (config.authMode !== 'hmac') throw new Error('账号管理 API 仅支持 HMAC 认证方式');
    if (!config.signingSecret) throw new Error('请先填写 HMAC 签名密钥');
    return hmacHeaders(config, url, method, body);
}

async function requestAccountManagementApi(rawConfig, path, { method = 'GET', payload = null } = {}) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    if (!config.enabled) throw new Error('账号管理 API 尚未启用');
    const url = new URL(`${config.endpointUrl}${path}`);
    const body = payload === null ? '' : JSON.stringify(payload);
    const response = await safeHttpText(url, {
        method,
        headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            'User-Agent': 'MarchCenter-Account-Management/1.1',
            ...authenticationHeaders(config, url, method, body)
        },
        ...(body ? { body } : {}),
        timeoutMs: config.timeoutMs,
        maxResponseBytes: 64 * 1024
    });
    let data = {};
    try { data = JSON.parse(response.data || '{}'); }
    catch { throw new Error('账号管理 API 返回了无效的 JSON'); }
    if (!response.ok) {
        const requestId = String(data.requestId || '').trim();
        const message = data.error || `账号管理 API 返回 HTTP ${response.status}`;
        const error = new Error(requestId ? `${message}（请求编号：${requestId}）` : message);
        error.statusCode = response.status;
        error.code = data.code || 'account_api_error';
        error.requestId = requestId;
        throw error;
    }
    return { data, statusCode: response.status };
}

export async function getDeviceInformation(rawConfig) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const { data } = await requestAccountManagementApi(config, '/api/v1/device/info');
    const deviceId = String(data.deviceId || '').trim();
    const publicKey = data.publicKey && typeof data.publicKey === 'object' ? data.publicKey : null;
    if (data.success !== true || !deviceId || !publicKey) {
        throw new Error('执行端未返回有效的设备身份信息，请确认 Windows 执行端已更新并重新启动');
    }
    return {
        deviceId: deviceId.slice(0, 100),
        publicKey,
        encryption: String(data.encryption || 'RSA-OAEP-SHA1').trim().slice(0, 40) || 'RSA-OAEP-SHA1'
    };
}

export async function issueManualCredential(rawConfig, system, username, platformUrl = '', databaseName = '', accountTable = '', usernameColumn = '', passwordColumn = '', passwordAlgorithm = '') {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    await ensureDeviceDatabaseConfig(config);
    const { data } = await requestAccountManagementApi(config, '/api/v1/accounts/issue-credential', {
        method: 'POST',
        payload: { system, username, platformUrl, databaseName, accountTable, usernameColumn, passwordColumn, passwordAlgorithm }
    });
    const password = String(data.password || data.temporaryPassword || '');
    if (!/^\d{6}$/.test(password)) {
        throw new Error('账号管理 API 未返回有效的 6 位密码');
    }
    const originalPasswordCiphertext = String(data.originalPasswordCiphertext || '').trim();
    if (originalPasswordCiphertext.length > 4096 || [...originalPasswordCiphertext].some(char => char.charCodeAt(0) < 32)) {
        throw new Error('账号管理 API 返回的原始密码密文无效');
    }
    return {
        username: String(data.username || username),
        password,
        originalPasswordCiphertext
    };
}

export async function restoreOriginalPassword(rawConfig, system, username, platformUrl = '', databaseName = '', accountTable = '', usernameColumn = '', passwordColumn = '', passwordAlgorithm = '', originalPasswordCiphertext = '') {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    await ensureDeviceDatabaseConfig(config);
    const { data } = await requestAccountManagementApi(config, '/api/v1/accounts/reset-password', {
        method: 'POST',
        payload: { system, username, platformUrl, databaseName, accountTable, usernameColumn, passwordColumn, passwordAlgorithm, originalPasswordCiphertext }
    });
    if (data.success !== true || data.updated !== true) {
        throw new Error('账号管理 API 未确认原始密码已恢复');
    }
    return { username: String(data.username || username) };
}

function buildClassDeleteOperations(mapping, className) {
    // 1. 先删除用户表关联行：DELETE FROM userTable WHERE userClassColumn IN
    //    (SELECT classIdColumn FROM classTable WHERE classNameColumn = className)
    //    —— 删除该班级的所有关联账号（学生/教师），避免只删班级留下坏教师。
    const operations = [{
        table: mapping.userTable,
        where: [{
            column: mapping.userClassColumn,
            inSelect: {
                table: mapping.classTable,
                selectColumn: mapping.classIdColumn,
                where: [{ column: mapping.classNameColumn, value: className }]
            }
        }]
    }];
    // 2. 删班级行本身：DELETE FROM classTable WHERE classNameColumn = className
    operations.push({ table: mapping.classTable, where: [{ column: mapping.classNameColumn, value: className }] });
    return operations;
}

function buildClassDeletePayload(config, { databaseName, className, system, platformUrl, mapping }) {
    const resolved = mapping || {};
    if (!isClassDeleteMappingReady(resolved)) {
        throw new Error('该竞赛卡片未配置完整的班级删除映射');
    }
    const targetDatabase = databaseName || resolved.databaseName;
    if (!targetDatabase) throw new Error('缺少平台数据库，请选择班级所在数据库');
    if (!className) throw new Error('班级名不能为空');
    return {
        system: system || 'java',
        platformUrl: platformUrl || '',
        databaseName: targetDatabase,
        operations: buildClassDeleteOperations(resolved, className)
    };
}

/**
 * 事务删除平台数据库中的班级及其关联行。执行端按 MarchCenter 编排的通用
 * db/delete 操作执行（子表按 class_id 匹配班级名子查询，班级行按名字精确删）。
 * 班级行无匹配时返回 notFound=true（幂等）。
 */
export async function deletePlatformClass(rawConfig, options) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const payload = buildClassDeletePayload(config, options);
    const { data } = await requestAccountManagementApi(config, '/api/v1/db/delete', {
        method: 'POST',
        payload
    });
    if (data.success !== true) {
        throw Object.assign(new Error(data.error || '执行端未确认班级删除成功'), { statusCode: 502 });
    }
    const classTable = options.mapping?.classTable || '';
    const classDeleted = Number((data.results || [])
        .find(result => result.table === classTable)?.deletedRows || 0);
    return {
        deleted: classDeleted > 0,
        notFound: classDeleted === 0,
        deletedRows: Number(data.deletedRows || data.totalDeletedRows || 0)
    };
}

export async function listAccountDatabases(rawConfig, provider) {
    const normalizedProvider = provider === 'mysql' ? 'mysql' : provider === 'sqlserver' ? 'sqlserver' : '';
    if (!normalizedProvider) throw new Error('数据库连接方式仅支持 SQL Server 或 MySQL');
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    await ensureDeviceDatabaseConfig(config);
    const { data } = await requestAccountManagementApi(config, `/api/v1/databases?provider=${encodeURIComponent(normalizedProvider)}`);
    return Array.isArray(data.databases) ? data.databases.map(String).filter(Boolean) : [];
}

export async function listAccountTables(rawConfig, provider, databaseName) {
    const normalizedProvider = provider === 'mysql' ? 'mysql' : provider === 'sqlserver' ? 'sqlserver' : '';
    if (!normalizedProvider) throw new Error('数据库类型无效');
    const normalizedDatabase = String(databaseName || '').trim();
    if (!normalizedDatabase) throw new Error('请先选择数据库');
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    await ensureDeviceDatabaseConfig(config);
    const { data } = await requestAccountManagementApi(
        config,
        `/api/v1/tables?provider=${encodeURIComponent(normalizedProvider)}&databaseName=${encodeURIComponent(normalizedDatabase)}`
    );
    return Array.isArray(data.tables) ? data.tables.map(String).filter(Boolean) : [];
}

export async function listAccountColumns(rawConfig, provider, databaseName, accountTable) {
    const normalizedProvider = provider === 'mysql' ? 'mysql' : provider === 'sqlserver' ? 'sqlserver' : '';
    if (!normalizedProvider) throw new Error('数据库类型无效');
    const normalizedDatabase = String(databaseName || '').trim();
    const normalizedTable = String(accountTable || '').trim();
    if (!normalizedDatabase) throw new Error('请先选择数据库');
    if (!normalizedTable) throw new Error('请先选择数据表');
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    await ensureDeviceDatabaseConfig(config);
    const { data } = await requestAccountManagementApi(
        config,
        `/api/v1/columns?provider=${encodeURIComponent(normalizedProvider)}&databaseName=${encodeURIComponent(normalizedDatabase)}&accountTable=${encodeURIComponent(normalizedTable)}`
    );
    return Array.isArray(data.columns) ? data.columns.map(String).filter(Boolean) : [];
}

export async function testAccountManagementApi(rawConfig) {
    const config = normalizeAccountManagementConfig(rawConfig, { requireEndpoint: true });
    const url = new URL(`${config.endpointUrl}${config.healthPath}`);
    const startedAt = Date.now();
    const response = await safeHttpText(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
            'User-Agent': 'MarchCenter-Account-Management/1.0',
            ...authenticationHeaders(config, url, 'GET', '')
        },
        timeoutMs: config.timeoutMs,
        maxResponseBytes: 64 * 1024
    });
    const latencyMs = Date.now() - startedAt;
    let health = null;
    try { health = JSON.parse(response.data || '{}'); } catch {}
    const setupRequired = response.status === 503 && (health?.status === 'setup_required' || health?.code === 'setup_required');
    if (!response.ok && !setupRequired) throw Object.assign(new Error(health?.error || `账号管理 API 返回 HTTP ${response.status}`), {
        statusCode: response.status,
        latencyMs,
        code: health?.code || 'health_check_failed'
    });
    return {
        success: true,
        latencyMs,
        statusCode: response.status,
        setupRequired,
        responsePreview: String(response.data || '').slice(0, 300)
    };
}
