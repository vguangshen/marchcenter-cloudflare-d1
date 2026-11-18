import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
    createProductionHarness,
    officialConfig
} from './helpers/productionHarness.mjs';

let harness;

before(async () => { harness = await createProductionHarness(); });
after(async () => { await harness?.dispose(); });
beforeEach(async () => { await harness.reset(); });

async function routeConfig(config) {
    const configId = await harness.seedConfig(config);
    const competitionId = await harness.seedCompetition({
        configId,
        method: config.method,
        url: 'http://localhost:9289/DS50108',
        classType: 1
    });
    return { configId, competitionId };
}

async function seedRoleUser(id, username, role) {
    await harness.seedUser({ id, username, role });
    return harness.issueToken({ id, username, role });
}

// 给学生/教师授予指定竞赛卡片的访问权限（模拟真实授权场景），
// 用于证明角色阻断发生在权限检查之前、不会被访问权绕开。
async function grantAccess(userId, competitionId) {
    await harness.run(
        `INSERT INTO user_access_policies (user_id, configured) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET configured = 1`,
        userId
    );
    await harness.run(
        `INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?)
         ON CONFLICT(user_id, competition_id) DO NOTHING`,
        userId, competitionId
    );
}

function asUser(token) {
    return {
        headers: { Authorization: `Bearer ${token}` }
    };
}

async function listedMaintenance(competitionId) {
    const response = await harness.api('/api/competitions');
    assert.equal(response.status, 200);
    return response.data.find(card => card.id === competitionId).maintenance;
}

test('competition list includes independent Java binding availability without contacting the platform', async () => {
    const config = officialConfig('java');
    const { configId, competitionId } = await routeConfig(config);
    const secondId = await harness.seedCompetition({
        configId, method: 'java', url: 'http://localhost:9289/DS50109', classType: 1
    });
    const unconfigured = await listedMaintenance(competitionId);
    assert.match(unconfigured.delete, /未配置 Java 班级删除映射/);
    assert.equal(unconfigured.repair, null);
    assert.equal(unconfigured.initialize, null);

    const mapping = {
        enabled: true, apiId: 'maintenance-bridge', databaseName: 'training',
        classTable: 'classes', classNameColumn: 'name', classIdColumn: 'id',
        userTable: 'users', userClassColumn: 'class_id'
    };
    await harness.run('UPDATE competitions SET class_delete_mapping = ? WHERE id = ?', JSON.stringify(mapping), competitionId);
    assert.match((await listedMaintenance(competitionId)).delete, /账号管理 API 不存在/);

    const storedService = enabled => JSON.stringify({ version: 2, services: [{
        id: mapping.apiId, enabled, endpointUrl: 'http://localhost:9001', signingSecret: 'maintenance-secret'
    }] });
    await harness.run('INSERT INTO system_configs (config_key, config_value) VALUES (?, ?)',
        'account_management_api', storedService(false));
    assert.match((await listedMaintenance(competitionId)).delete, /已停用/);

    await harness.run('UPDATE system_configs SET config_value = ? WHERE config_key = ?',
        JSON.stringify({ version: 2, services: [{ id: mapping.apiId, enabled: true }] }), 'account_management_api');
    const incomplete = await listedMaintenance(competitionId);
    assert.match(incomplete.delete, /账号管理 API 不存在/);
    assert.equal(incomplete.repair, null);

    await harness.run('UPDATE system_configs SET config_value = ? WHERE config_key = ?',
        storedService(true), 'account_management_api');
    const ready = await harness.api('/api/competitions');
    assert.equal(ready.status, 200);
    const enabled = ready.data.find(card => card.id === competitionId);
    const second = ready.data.find(card => card.id === secondId);
    assert.deepEqual(enabled.maintenance, { delete: null, repair: null, initialize: null });
    assert.match(second.maintenance.delete, /未配置 Java 班级删除映射/);
    assert.ok(!JSON.stringify(ready.data).includes('maintenance-secret'));

    await harness.run('UPDATE competitions SET manual_credential_enabled = 1, restore_original_password_before_sso = 1 WHERE id = ?', competitionId);
    await harness.run(
        `INSERT INTO user_manual_teacher_credentials (user_id, competition_id, username, login_url, encrypted_password)
         VALUES (1, ?, 'teacher', 'https://example.invalid', 'test-ciphertext')`, competitionId
    );
    const restorePending = await listedMaintenance(competitionId);
    assert.match(restorePending.repair, /设备及数据库连接/);
    assert.equal(restorePending.delete, null);
    assert.equal(restorePending.initialize, null);

    await harness.run('UPDATE sso_configs SET config_data = ? WHERE id = ?', JSON.stringify({ ...config, tokenPassword: '' }), configId);
    const missingCredentials = await listedMaintenance(competitionId);
    assert.equal(missingCredentials.delete, null);
    assert.match(missingCredentials.repair, /免密接口凭据/);
    assert.match(missingCredentials.initialize, /免密接口凭据/);
    assert.equal(harness.platform.state.requests.length, 0);
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
});

test('competition list permits SOAP class deletion without a Java mapping and respects roles and card access', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    const path = '/api/competitions';
    const teacherToken = await seedRoleUser(38, 'maintenance-teacher', 'teacher');
    const studentToken = await seedRoleUser(39, 'maintenance-student', 'student');
    const unauthorized = await harness.api(path, asUser(teacherToken));
    assert.equal(unauthorized.status, 200);
    assert.equal(unauthorized.data.some(card => card.id === competitionId), false);
    await grantAccess(38, competitionId);
    await grantAccess(39, competitionId);

    const teacher = await harness.api(path, asUser(teacherToken));
    assert.equal(teacher.status, 200);
    assert.deepEqual(teacher.data.find(card => card.id === competitionId).maintenance,
        { delete: null, repair: null, initialize: '需要管理员或超级管理员权限' });
    const student = await harness.api(path, asUser(studentToken));
    assert.equal(student.status, 200);
    assert.equal(student.data.find(card => card.id === competitionId).maintenance, undefined);
    assert.equal((await harness.api(`/api/sso/maintenance/${competitionId}`)).status, 404);
    assert.equal(harness.platform.state.requests.length, 0);
});

test('student cannot remove remote classes even with card access', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    const studentToken = await seedRoleUser(10, 'e2e-student', 'student');
    await grantAccess(10, competitionId);

    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId },
        ...asUser(studentToken)
    });
    assert.equal(response.status, 403);
    assert.match(response.data.error, /学生无权删除远程班级/);
    assert.equal(harness.platform.state.requests.length, 0, '学生请求不得触达远端平台');
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
});

test('student cannot request or execute module initialization', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const studentToken = await seedRoleUser(10, 'e2e-student', 'student');
    await grantAccess(10, competitionId);

    const confirm = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId },
        ...asUser(studentToken)
    });
    assert.equal(confirm.status, 403);
    assert.match(confirm.data.error, /管理员或超级管理员/);

    const init = await harness.api('/api/sso/module/init', {
        body: { competitionId },
        ...asUser(studentToken)
    });
    assert.equal(init.status, 403);
    assert.match(init.data.error, /管理员或超级管理员/);
    assert.equal(harness.platform.state.requests.length, 0);
});

test('admin role can request and execute module initialization', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const adminToken = await seedRoleUser(11, 'e2e-admin-role', 'admin');

    const confirm = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId },
        ...asUser(adminToken)
    });
    assert.equal(confirm.status, 200);
    assert.ok(confirm.data.confirmToken);

    harness.platform.queueJava('reinitializeSystem', { code: 10000, succ: true, message: '成功', data: true });
    const init = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: confirm.data.confirmToken },
        ...asUser(adminToken)
    });
    assert.equal(init.status, 200);
    assert.equal(init.data.initialized, true);
    assert.ok(harness.platform.state.requests.some(request => request.operationName === 'reinitializeSystem'));
    const rows = await harness.rows('SELECT user_id FROM user_class_removals');
    assert.equal(Number(rows[0].user_id), 11);
});

test('teacher can still remove their own remote class', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    const teacherToken = await seedRoleUser(12, 'e2e-teacher', 'teacher');
    await grantAccess(12, competitionId);

    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId },
        ...asUser(teacherToken)
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.deleted, false);
    assert.equal(response.data.className, 'mce2e-teacher');
    assert.deepEqual(
        harness.platform.state.requests.map(request => request.operationName),
        ['IsGroupExisted']
    );
    const rows = await harness.rows('SELECT user_id FROM user_class_removals');
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), 12);
});

test('module init requires the one-time confirmation token', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));

    const missing = await harness.api('/api/sso/module/init', {
        body: { competitionId }
    });
    assert.equal(missing.status, 403);
    assert.match(missing.data.error, /缺少模块初始化确认令牌/);

    const wrong = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: 'not-the-issued-token' }
    });
    assert.equal(wrong.status, 403);
    assert.match(wrong.data.error, /无效、已过期或已使用/);
    assert.equal(harness.platform.state.requests.length, 0);
});

test('module init confirm token is single-use and a new issue invalidates the old one', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));

    const first = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId }
    });
    assert.equal(first.status, 200);
    assert.ok(first.data.confirmToken);

    const second = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId }
    });
    assert.equal(second.status, 200);
    assert.notEqual(second.data.confirmToken, first.data.confirmToken);

    const stale = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: first.data.confirmToken }
    });
    assert.equal(stale.status, 403, '重新申请后旧令牌必须立即失效');
    assert.match(stale.data.error, /无效、已过期或已使用/);

    harness.platform.queueJava('reinitializeSystem', { code: 10000, succ: true, message: '成功', data: true });
    const executed = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: second.data.confirmToken }
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.data.initialized, true);
});

test('expired module init confirm token is rejected', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const confirm = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId }
    });
    assert.equal(confirm.status, 200);
    await harness.run(
        'UPDATE module_init_confirmations SET expires_at = ? WHERE competition_id = ?',
        '2000-01-01T00:00:00.000Z', competitionId
    );

    const response = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: confirm.data.confirmToken }
    });
    assert.equal(response.status, 403);
    assert.match(response.data.error, /无效、已过期或已使用/);
    assert.equal(harness.platform.state.requests.length, 0);
});

test('module init confirm rejects invalid card ids and non-JAVA methods', async () => {
    const invalid = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId: 'abc' }
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.error, /竞赛卡片无效/);

    const missing = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId: 99999 }
    });
    assert.equal(missing.status, 404);
    assert.match(missing.data.error, /竞赛卡片不存在/);

    const { competitionId } = await routeConfig(officialConfig('net'));
    const unsupported = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId }
    });
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.data.error, /不支持模块初始化/);
    assert.equal((await harness.rows('SELECT * FROM module_init_confirmations')).length, 0);
});
