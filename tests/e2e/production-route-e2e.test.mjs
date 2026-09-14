import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import {
    createProductionHarness,
    E2E_SECRETS,
    officialConfig
} from './helpers/productionHarness.mjs';
import { normalizeAccountManagementConfig } from '../../server/utils/accountManagementApi.js';

let harness;

const NET_LOGIN_DES_KEY = Buffer.from('12345678itmcitmc87654321', 'utf8');

function decryptNetLoginField(value) {
    const decipher = createDecipheriv('des-ede3', NET_LOGIN_DES_KEY, Buffer.alloc(0));
    decipher.setAutoPadding(true);
    return Buffer.concat([
        decipher.update(String(value), 'base64'),
        decipher.final()
    ]).toString('utf8');
}

before(async () => { harness = await createProductionHarness(); });
after(async () => { await harness?.dispose(); });
beforeEach(async () => { await harness.reset(); });

async function routeConfig(config, options = {}) {
    const configId = await harness.seedConfig(config, options);
    const competitionId = await harness.seedCompetition({
        configId,
        method: config.method,
        url: options.cardUrl || 'http://localhost:9289/DS50108',
        classType: options.classType ?? config.classType ?? 1
    });
    return { configId, competitionId };
}

async function execute(competitionId, context = {}, dryRun = false) {
    return harness.api('/api/sso/execute', {
        body: { competitionId, context, dryRun }
    });
}

async function seedAccountService() {
    const service = normalizeAccountManagementConfig({
        id: 'e2e-account-service',
        name: 'E2E 账号服务',
        enabled: true,
        endpointUrl: 'http://localhost:9001',
        authMode: 'hmac',
        signingSecret: 'e2e-hmac-signing-secret'
    });
    await harness.run(
        `INSERT INTO system_configs (config_key, config_value, updated_at)
         VALUES ('account_management_api', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = CURRENT_TIMESTAMP`,
        JSON.stringify({ version: 2, services: [service] })
    );
    return service.id;
}

const CLASS_DELETE_MAPPING = {
    enabled: true,
    apiId: 'e2e-account-service',
    databaseName: 'cloud_training',
    classTable: 'user_class',
    classNameColumn: 'uc_name',
    classIdColumn: 'id',
    userTable: 'user_info',
    userClassColumn: 'class_id'
};

async function bindClassDelete(competitionId, mapping = CLASS_DELETE_MAPPING) {
    await harness.run(
        'UPDATE competitions SET class_delete_mapping = ? WHERE id = ?',
        JSON.stringify(mapping), competitionId
    );
}

function operationNames() {
    return harness.platform.state.requests.map(request => request.operationName);
}

function success(data, overrides = {}) {
    return { code: overrides.code ?? 10000, succ: overrides.succ ?? true, message: overrides.message ?? '成功', data };
}

async function statusRows() {
    return harness.rows('SELECT * FROM user_platform_account_status ORDER BY competition_id, login_role');
}

test('configuration API saves, reads and redacts the sole official adapter template', async () => {
    const config = officialConfig('java');
    const saved = await harness.api('/api/sso-config', {
        body: { name: 'Official JAVA', baseUrl: '', configData: JSON.stringify(config) }
    });
    assert.equal(saved.status, 200);
    const listed = await harness.api('/api/sso-config');
    const parsed = JSON.parse(listed.data[0].configData);
    assert.equal('adapter' + 'Mode' in parsed, false);
    assert.equal('instance' + 'Variant' in parsed, false);
    assert.equal(parsed.officialBaseUrl, undefined);
    assert.equal(parsed.officialBaseUrlConfirmed, undefined);
    assert.equal(parsed.tokenNumber, E2E_SECRETS.tokenNumber);
    assert.equal(parsed.tokenPassword, undefined);
    assert.equal(parsed.configuredSecrets.tokenPassword, true);
    assert.doesNotMatch(listed.text, new RegExp(E2E_SECRETS.tokenPassword));

    const revealed = await harness.api(`/api/sso-config/${saved.data.id}/reveal-secrets`, { body: {} });
    assert.equal(revealed.status, 200);
    assert.equal(revealed.data.tokenPassword, E2E_SECRETS.tokenPassword);
    assert.equal(revealed.data.soapPassword, E2E_SECRETS.soapPassword);
    assert.equal(revealed.response.headers.get('cache-control'), 'no-store');
});

test('card save is the sole visible address and auto-binds the method config without mutating it', async () => {
    const template = officialConfig('java', { officialBaseUrl: undefined, officialBaseUrlConfirmed: undefined });
    const created = await harness.api('/api/sso-config', {
        body: { name: 'Card-address JAVA', baseUrl: '', configData: template }
    });
    assert.equal(created.status, 200);
    const cardUrl = 'http://localhost:9289/DS-CARD-ONLY';
    const card = await harness.api('/api/competitions', {
        body: {
            title: 'Card address roundtrip', subtitle: '', url: cardUrl, category: 'E2E',
            statusText: '开放', description: '', color: 'blue', customIcon: '',
            logoBackground: 'transparent', unlockTime: '', lockTime: '', customPrompt: '',
            ssoMethod: 'java', manualCredentialEnabled: false
        }
    });
    assert.equal(card.status, 200);
    const [stored] = await harness.rows('SELECT config_data FROM sso_configs WHERE id = ?', created.data.id);
    const parsed = JSON.parse(stored.config_data);
    assert.equal(parsed.officialBaseUrl, undefined);
    assert.equal(parsed.officialBaseUrlConfirmed, undefined);
    const listed = await harness.api('/api/competitions');
    assert.equal(listed.data[0].url, cardUrl);
    assert.equal(listed.data[0].ssoConfigId, created.data.id);
    assert.equal('adapter' + 'Mode' in listed.data[0], false);
});

test('card appearance update persists a white logo surface without breaking existing business fields', async () => {
    await harness.api('/api/sso-config', {
        body: { name: 'Appearance JAVA', baseUrl: '', configData: officialConfig('java') }
    });
    const original = {
        title: 'Appearance roundtrip', subtitle: '', url: 'http://localhost:9289/APPEARANCE',
        category: 'E2E', statusText: '长期开放', description: '', color: 'blue',
        customIcon: 'data:image/png;base64,aGVsbG8=', logoBackground: 'transparent',
        unlockTime: '', lockTime: '', customPrompt: '', ssoMethod: 'java', classType: 1,
        accountApiId: '', accountDbProvider: 'mysql', accountDbName: '', accountTableName: '',
        accountUsernameColumn: '', accountPasswordColumn: '', accountPasswordAlgorithm: '',
        manualCredentialEnabled: false, restoreOriginalPasswordBeforeSso: false,
        restoreOriginalPasswordCiphertext: '', hasRestoreOriginalPasswordCiphertext: false,
        classDeleteMapping: null
    };
    const created = await harness.api('/api/competitions', { body: original });
    assert.equal(created.status, 200);

    const updated = await harness.api(`/api/competitions/${created.data.id}`, {
        method: 'PUT',
        body: { ...original, logoBackground: 'white' }
    });
    assert.equal(updated.status, 200, updated.text);
    const [stored] = await harness.rows(
        'SELECT logo_background AS logoBackground, color FROM competitions WHERE id = ?',
        created.data.id
    );
    assert.deepEqual(stored, { logoBackground: 'white', color: 'blue' });
});

test('administrator original password ciphertext roundtrips from the database but is hidden from non-super-admin users', async () => {
    await harness.api('/api/sso-config', {
        body: { name: 'Ciphertext JAVA', baseUrl: '', configData: officialConfig('java') }
    });
    const ciphertext = 'JAVA_PLATFORM_ORIGINAL_CIPHERTEXT_9F8E7D';
    const created = await harness.api('/api/competitions', {
        body: {
            title: 'Ciphertext card', subtitle: '', url: 'http://localhost:9289/CIPHER',
            category: 'E2E', statusText: '开放', description: '', color: 'blue', customIcon: '',
            logoBackground: 'transparent', unlockTime: '', lockTime: '', customPrompt: '',
            ssoMethod: 'java', classType: 1, accountApiId: 'svc', accountDbProvider: 'mysql',
            accountDbName: 'cloud_training', accountTableName: 'user_info',
            accountUsernameColumn: 'login_name', accountPasswordColumn: 'password',
            accountPasswordAlgorithm: 'itmc-java-long-md5', manualCredentialEnabled: true,
            restoreOriginalPasswordBeforeSso: true, restoreOriginalPasswordCiphertext: ciphertext,
            classDeleteMapping: null
        }
    });
    assert.equal(created.status, 200, created.text);
    const [stored] = await harness.rows(
        'SELECT restore_original_password_ciphertext AS ciphertext FROM competitions WHERE id = ?',
        created.data.id
    );
    assert.equal(stored.ciphertext, ciphertext);

    const adminList = await harness.api('/api/competitions');
    const adminCard = adminList.data.find(item => Number(item.id) === Number(created.data.id));
    assert.equal(adminCard.restoreOriginalPasswordCiphertext, ciphertext);
    assert.equal(Boolean(adminCard.hasRestoreOriginalPasswordCiphertext), true);

    await harness.seedUser({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedToken = await harness.issueToken({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedResponse = await harness.miniflare.dispatchFetch('http://marchcenter.local/api/competitions', {
        headers: { Authorization: `Bearer ${limitedToken}` }
    });
    const limitedCards = await limitedResponse.json();
    const limitedCard = limitedCards.find(item => Number(item.id) === Number(created.data.id));
    assert.equal('restoreOriginalPasswordCiphertext' in limitedCard, false);
    assert.equal(Boolean(limitedCard.hasRestoreOriginalPasswordCiphertext), true);
});

test('per-card Admin credentials are encrypted at rest and only revealed to the super administrator endpoint', async () => {
    await harness.api('/api/sso-config', {
        body: { name: 'Admin entry JAVA', baseUrl: '', configData: officialConfig('java') }
    });
    const password = 'ADMIN_ENTRY_PASSWORD_E2E';
    const cardPayload = {
            title: 'Admin entry card', subtitle: '', url: 'http://localhost:9289/ADMIN-ENTRY',
            category: 'E2E', statusText: '开放', description: '', color: 'blue', customIcon: '',
            logoBackground: 'transparent', unlockTime: '', lockTime: '', customPrompt: '',
            ssoMethod: 'java', classType: 1, manualCredentialEnabled: false,
            adminEntryEnabled: true, adminEntryUsername: 'Admin', adminEntryPassword: password
    };
    const created = await harness.api('/api/competitions', { body: cardPayload });
    assert.equal(created.status, 200, created.text);
    assert.doesNotMatch(created.text, new RegExp(password));

    const [stored] = await harness.rows(
        'SELECT admin_entry_credentials AS credentials FROM competitions WHERE id = ?',
        created.data.id
    );
    assert.match(stored.credentials, /^v1\./);
    assert.doesNotMatch(stored.credentials, new RegExp(password));

    const listed = await harness.api('/api/competitions');
    const card = listed.data.find(item => Number(item.id) === Number(created.data.id));
    assert.equal(card.adminEntryUsername, 'Admin');
    assert.equal(Boolean(card.hasAdminEntryPassword), true);
    assert.equal('adminEntryCredentials' in card, false);
    assert.doesNotMatch(listed.text, new RegExp(password));

    const revealed = await harness.api(`/api/sso/admin-credential/${created.data.id}`);
    assert.equal(revealed.status, 200, revealed.text);
    assert.equal(revealed.data.credential.label, 'Admin');
    assert.equal(revealed.data.credential.username, 'Admin');
    assert.equal(revealed.data.credential.password, password);
    assert.equal(revealed.response.headers.get('cache-control'), 'no-store');

    const preserved = await harness.api(`/api/competitions/${created.data.id}`, {
        method: 'PUT', body: { ...cardPayload, adminEntryPassword: '' }
    });
    assert.equal(preserved.status, 200, preserved.text);
    const revealedAgain = await harness.api(`/api/sso/admin-credential/${created.data.id}`);
    assert.equal(revealedAgain.data.credential.password, password);

    await harness.seedUser({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedToken = await harness.issueToken({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedResponse = await harness.miniflare.dispatchFetch(
        `http://marchcenter.local/api/sso/admin-credential/${created.data.id}`,
        { headers: { Authorization: `Bearer ${limitedToken}` } }
    );
    assert.equal(limitedResponse.status, 403);

    const prepared = await harness.api(`/api/sso/admin-entry/${created.data.id}/prepare`, { body: {} });
    assert.equal(prepared.status, 200, prepared.text);
    assert.equal(prepared.data.preparation.redirectUrl, `${cardPayload.url}/pages/admin/admin_index.html`);
    assert.equal(prepared.data.preparation.settleDelayMs, undefined);
    assert.doesNotMatch(prepared.text, new RegExp(password));

    const relayResponse = await harness.miniflare.dispatchFetch(
        `https://marchcenter.local${prepared.data.preparation.relayPath}`,
        { redirect: 'manual' }
    );
    assert.equal(relayResponse.status, 302, await relayResponse.text());
    const loginUrl = new URL(relayResponse.headers.get('location'));
    assert.equal(loginUrl.href, `${cardPayload.url}/checkLogin?username=Admin&password=${password}`);
    assert.equal((await harness.miniflare.dispatchFetch(
        `https://marchcenter.local${prepared.data.preparation.relayPath}`,
        { redirect: 'manual' }
    )).status, 410);
});

test('.NET Root entry redirects once to the platform-native encrypted GET login without revealing plaintext credentials', async () => {
    await harness.api('/api/sso-config', {
        body: { name: 'Root entry NET', baseUrl: '', configData: officialConfig('net') }
    });
    const username = 'ROOT_ENTRY_USER_E2E';
    const password = 'ROOT_ENTRY_PASSWORD_E2E';
    const cardUrl = 'http://localhost:9289/ROOT-ENTRY';
    const created = await harness.api('/api/competitions', {
        body: {
            title: 'Root entry card', subtitle: '', url: cardUrl,
            category: 'E2E', statusText: '开放', description: '', color: 'blue', customIcon: '',
            logoBackground: 'transparent', unlockTime: '', lockTime: '', customPrompt: '',
            ssoMethod: 'net', classType: 1, manualCredentialEnabled: false,
            adminEntryEnabled: true, adminEntryUsername: username, adminEntryPassword: password
        }
    });
    assert.equal(created.status, 200, created.text);

    const prepared = await harness.api(`/api/sso/admin-entry/${created.data.id}/prepare`, { body: {} });
    assert.equal(prepared.status, 200, prepared.text);
    assert.equal(prepared.response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(prepared.text, new RegExp(username));
    assert.doesNotMatch(prepared.text, new RegExp(password));
    assert.match(prepared.data.preparation.relayPath, /^\/api\/sso\/admin-entry\/relay\/[a-f0-9]{64}$/);
    assert.equal(prepared.data.preparation.relayProtocol, undefined);
    assert.equal(prepared.data.preparation.logoutUrl, undefined);
    assert.equal(prepared.data.preparation.redirectUrl, `${cardUrl}/Main/TeacherMain.aspx?GroupType=1`);
    assert.equal(prepared.data.preparation.settleDelayMs, undefined);

    const relayResponse = await harness.miniflare.dispatchFetch(
        `https://marchcenter.local${prepared.data.preparation.relayPath}`,
        { redirect: 'manual' }
    );
    assert.equal(relayResponse.status, 302, await relayResponse.text());
    assert.equal(relayResponse.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(relayResponse.headers.get('referrer-policy'), 'no-referrer');
    const loginUrl = new URL(relayResponse.headers.get('location'));
    assert.equal(loginUrl.origin, new URL(cardUrl).origin);
    assert.equal(loginUrl.pathname, '/ROOT-ENTRY/Login.aspx');
    assert.equal(loginUrl.searchParams.get('op'), 'Login');
    assert.equal(loginUrl.searchParams.get('s'), 'out');
    assert.equal(decryptNetLoginField(loginUrl.searchParams.get('UserName')), username);
    assert.equal(decryptNetLoginField(loginUrl.searchParams.get('Password')), password);
    assert.equal(decryptNetLoginField(loginUrl.searchParams.get('VerifyCode')), '');
    assert.equal(loginUrl.searchParams.get('LoginIP'), '');
    assert.equal(loginUrl.searchParams.get('LoginCity'), '');

    const replayed = await harness.miniflare.dispatchFetch(
        `https://marchcenter.local${prepared.data.preparation.relayPath}`,
        { redirect: 'manual' }
    );
    assert.equal(replayed.status, 410);

    const revealed = await harness.api(`/api/sso/admin-credential/${created.data.id}`);
    assert.equal(revealed.data.credential.label, 'Root');

    await harness.seedUser({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedToken = await harness.issueToken({ id: 2, username: 'limited-admin', role: 'admin' });
    const limitedResponse = await harness.miniflare.dispatchFetch(
        `http://marchcenter.local/api/sso/admin-entry/${created.data.id}/prepare`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${limitedToken}`,
                'Content-Type': 'application/json'
            },
            body: '{}'
        }
    );
    assert.equal(limitedResponse.status, 403);
});

test('each method has one config and cards bind it automatically', async () => {
    const template = officialConfig('java', { officialBaseUrl: undefined, officialBaseUrlConfirmed: undefined });
    const first = await harness.api('/api/sso-config', {
        body: { name: 'JAVA 一号系统', baseUrl: '', configData: template }
    });
    const duplicate = await harness.api('/api/sso-config', {
        body: { name: 'JAVA 二号系统', baseUrl: '', configData: template }
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.data.error, /每种接入方式只保留一份配置/);
    const cardUrl = 'http://localhost:9289/JAVA-INSTANCE-TWO';
    const card = await harness.api('/api/competitions', {
        body: {
            title: 'Explicit instance', subtitle: '', url: cardUrl, category: 'E2E', statusText: '开放',
            description: '', color: 'blue', customIcon: '', logoBackground: 'transparent',
            unlockTime: '', lockTime: '', customPrompt: '',
            ssoMethod: 'java', classType: 1, manualCredentialEnabled: false
        }
    });
    assert.equal(card.status, 200);
    const rows = await harness.rows('SELECT id, config_data FROM sso_configs ORDER BY id');
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].config_data).officialBaseUrl, undefined);
    const storedCard = (await harness.rows(
        'SELECT sso_config_id AS ssoConfigId FROM competitions WHERE id = ?', card.data.id
    ))[0];
    assert.equal(storedCard.ssoConfigId, first.data.id);
});

test('configuration API accepts address-less templates and rejects unsupported methods', async () => {
    const addressless = await harness.api('/api/sso-config', {
        body: {
            name: 'addressless official template', baseUrl: '', configData: { method: 'java' }
        }
    });
    assert.equal(addressless.status, 200);
    const unsupported = await harness.api('/api/sso-config', {
        body: { name: 'unsupported', baseUrl: '', configData: { method: 'unknown' } }
    });
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.data.error, /不支持/);
    assert.equal((await harness.rows('SELECT * FROM sso_configs')).length, 1);
});

test('card save rejects full interface, query and trailing-slash addresses', async t => {
    const cases = [
        ['WSDL', 'http://localhost:9289/DS/NormWebService.asmx'],
        ['trailing slash', 'http://localhost:9289/DS/'],
        ['query', 'http://localhost:9289/DS?WSDL'],
        ['/open', 'http://localhost:9289/DS/open']
    ];
    for (const [label, url] of cases) {
        await t.test(label, async () => {
            const created = await harness.api('/api/sso-config', {
                body: { name: 'JAVA', baseUrl: '', configData: { method: 'java' } }
            });
            assert.equal(created.status, 200);
            const response = await harness.api('/api/competitions', {
                body: {
                    title: label, subtitle: '', url, category: 'E2E', statusText: '开放',
                    description: '', color: 'blue', customIcon: '', logoBackground: 'transparent',
                    unlockTime: '', lockTime: '', customPrompt: '', ssoMethod: 'java',
                    manualCredentialEnabled: false
                }
            });
            assert.equal(response.status, 400);
            assert.match(response.data.error, /officialBaseUrl|尾斜杠|WSDL|完整接口路径/i);
        });
    }
    assert.equal((await harness.rows('SELECT * FROM competitions')).length, 0);
});

test('official dry-run is zero-network and zero-write including auth presence state', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const beforeUser = await harness.rows('SELECT last_seen_at, last_ip, user_agent FROM users WHERE id = 1');
    const response = await execute(competitionId, { loginRole: 'student' }, true);
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(harness.platform.state.requests.length, 0);
    assert.deepEqual(await statusRows(), []);
    assert.deepEqual(await harness.rows('SELECT * FROM user_workflow_status'), []);
    assert.deepEqual(await harness.rows('SELECT last_seen_at, last_ip, user_agent FROM users WHERE id = 1'), beforeUser);
});

test('official direct route returns the confirmed URL unchanged without remote calls', async () => {
    const staleSettingsAddress = 'http://localhost:9289/direct-entry';
    const cardUrl = 'http://localhost:9289/card-url?from=card';
    const { competitionId } = await routeConfig(officialConfig('direct', { officialBaseUrl: staleSettingsAddress }), {
        cardUrl
    });
    const response = await execute(competitionId);
    assert.equal(response.status, 200);
    assert.equal(response.data.redirectUrl, cardUrl);
    assert.equal(harness.platform.state.requests.length, 0);
    assert.equal((await statusRows()).length, 1);
});

test('official JAVA student train route performs token, sync and ticket in exact order', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const response = await execute(competitionId, { loginRole: 'student' });
    assert.equal(response.status, 200);
    assert.deepEqual(operationNames(), ['tokenInfo', 'getUserName', 'trainingExamPaper']);
    assert.equal(operationNames().filter(name => name === 'tokenInfo').length, 1);
    assert.equal(response.data.redirectUrl,
        'http://localhost:9289/DS50108/open/enterIndex?u=student+ticket+%2B%25%26');
    assert.doesNotMatch(response.data.redirectUrl, /\/open\/open\//);
    assert.equal((await statusRows()).length, 1);
});

test('official JAVA second entry skips duplicate account sync but refreshes its ticket', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await execute(competitionId);
    harness.platform.state.requests.length = 0;
    const second = await execute(competitionId);
    assert.equal(second.data.accountWasReady, true);
    assert.deepEqual(operationNames(), ['tokenInfo', 'trainingExamPaper']);
    assert.equal((await statusRows()).length, 1);
});

test('JAVA login repair immediately resyncs teacher, primary student and additional students', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await harness.run(
        `INSERT INTO user_competition_student_accounts
            (user_id, competition_id, student_index, account_name, status)
         VALUES (1, ?, 2, 'mse2e-admin2', 'ready')`,
        competitionId
    );

    const repair = await harness.api(`/api/sso/account-readiness/${competitionId}/repair`, { body: {} });
    assert.equal(repair.status, 200, JSON.stringify(repair.data));
    assert.equal(repair.data.mode, 'java_repaired');
    assert.deepEqual(repair.data.repaired, [
        { loginRole: 'teacher', studentIndex: 1 },
        { loginRole: 'student', studentIndex: 1 },
        { loginRole: 'student', studentIndex: 2 }
    ]);
    assert.deepEqual(operationNames(), [
        'tokenInfo', 'getLoginTeacherName', 'getUserName',
        'tokenInfo', 'getUserName', 'trainingExamPaper',
        'tokenInfo', 'getUserName', 'trainingExamPaper'
    ]);
    assert.deepEqual((await statusRows()).map(row => [row.login_role, row.student_index]), [
        ['student', 1], ['student', 2], ['teacher', 1]
    ]);

    harness.platform.state.requests.length = 0;
    const teacher = await execute(competitionId, { loginRole: 'teacher' });
    assert.equal(teacher.status, 200, JSON.stringify(teacher.data));
    assert.equal(teacher.data.accountWasReady, true);
    assert.deepEqual(operationNames(), ['tokenInfo', 'getLoginTeacherName']);

    harness.platform.state.requests.length = 0;
    const student = await execute(competitionId, { loginRole: 'student' });
    assert.equal(student.status, 200, JSON.stringify(student.data));
    assert.equal(student.data.accountWasReady, true);
    assert.deepEqual(operationNames(), ['tokenInfo', 'trainingExamPaper']);
});

test('official JAVA token is reused across production requests in one Worker isolate', async () => {
    // The regular route harness keeps requests isolated so its historical
    // operation-order tests remain deterministic.  This dedicated harness
    // enables the actual Worker composition cache and still uses only the
    // loopback mock platform.
    const cacheHarness = await createProductionHarness({ officialTokenCacheScope: 'isolate' });
    try {
        const config = officialConfig('java');
        const configId = await cacheHarness.seedConfig(config);
        const competitionId = await cacheHarness.seedCompetition({
            configId, method: 'java', url: config.officialBaseUrl
        });
        const executeCached = () => cacheHarness.api('/api/sso/execute', {
            body: { competitionId, context: { loginRole: 'student' } }
        });

        const first = await executeCached();
        assert.equal(first.status, 200, JSON.stringify(first.data));
        assert.deepEqual(
            cacheHarness.platform.state.requests.map(request => request.operationName),
            ['tokenInfo', 'getUserName', 'trainingExamPaper']
        );

        cacheHarness.platform.state.requests.length = 0;
        const second = await executeCached();
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.deepEqual(
            cacheHarness.platform.state.requests.map(request => request.operationName),
            ['trainingExamPaper']
        );
    } finally {
        await cacheHarness.dispose();
    }
});

test('official JAVA exam and teacher production routes select their confirmed operation sequences', async t => {
    await t.test('exam', async () => {
        const { competitionId } = await routeConfig(officialConfig('java', { trainOrExam: 'exam' }));
        await execute(competitionId);
        assert.deepEqual(operationNames(), ['tokenInfo', 'getUserName', 'trainingExamPaperV2']);
    });
    await harness.reset();
    await t.test('teacher', async () => {
        const { competitionId } = await routeConfig(officialConfig('java'));
        const response = await execute(competitionId, { loginRole: 'teacher' });
        assert.deepEqual(operationNames(), ['tokenInfo', 'getLoginTeacherName', 'getUserName']);
        const teacherLookup = harness.platform.state.requests.find(item => item.operationName === 'getLoginTeacherName');
        const studentSync = harness.platform.state.requests.find(item => item.operationName === 'getUserName');
        assert.equal(teacherLookup.body.u, 'mce2e-admin');
        assert.equal(studentSync.body.u, 'mcse2e-admin1');
        assert.match(
            response.data.redirectUrl,
            /\/open\/teacherIndex\?needTheoryScore=1&teacherUserName=teacher\+ticket\+%2B%25%26&className=/
        );
        assert.doesNotMatch(response.data.redirectUrl, /\/open\/open\//);
    });
});

test('official JAVA 10011 reruns whole method once and writes readiness once', async () => {
    harness.platform.queueJava('trainingExamPaper', [
        success(null, { code: 10011, succ: false, message: 'token expired' }),
        success('after retry +')
    ]);
    const { competitionId } = await routeConfig(officialConfig('java'));
    const response = await execute(competitionId);
    assert.equal(response.status, 200);
    assert.deepEqual(operationNames(), [
        'tokenInfo', 'getUserName', 'trainingExamPaper',
        'tokenInfo', 'getUserName', 'trainingExamPaper'
    ]);
    assert.equal((await statusRows()).length, 1);
});

test('three JAVA 10011 failures return route error without readiness or another execution path', async () => {
    harness.platform.queueJava('trainingExamPaper', Array.from({ length: 3 }, () =>
        success(null, { code: 10011, succ: false, message: 'expired' })));
    const { competitionId } = await routeConfig(officialConfig('java'));
    const response = await execute(competitionId);
    assert.equal(response.status, 500);
    assert.equal(response.data.code, 'internal_error');
    assert.equal(operationNames().filter(name => name === 'trainingExamPaper').length, 3);
    assert.equal(operationNames().filter(name => name === 'tokenInfo').length, 3);
    assert.deepEqual(await statusRows(), []);
});

for (const method of ['net', 'marketing', 'commerce']) {
    test(`official ${method} second entry uses the local ready-account fast path`, async () => {
        const { competitionId } = await routeConfig(officialConfig(method));
        if (method === 'net') {
            await harness.run(
                `INSERT INTO user_competition_student_accounts
                    (user_id, competition_id, student_index, account_name, status)
                 VALUES (1, ?, 2, 'mse2e-admin2', 'ready')`,
                competitionId
            );
        }
        const first = await execute(competitionId);
        assert.equal(first.status, 200);
        assert.deepEqual(operationNames(), ['IsGroupExisted', 'AddTrainGroup', 'IsStuExisted', 'AddStudent']);
        assert.match(first.data.redirectUrl, /\/Login\.aspx\?type=itmc&data=[A-F0-9]+$/);
        harness.platform.state.requests.length = 0;
        const second = await execute(competitionId);
        assert.equal(second.data.accountWasReady, true);
        assert.deepEqual(operationNames(), []);
        assert.match(second.data.redirectUrl, /\/Login\.aspx\?type=itmc&data=[A-F0-9]+$/);
        assert.equal((await statusRows()).length, 1);

        harness.platform.state.requests.length = 0;
        const repair = await harness.api(`/api/sso/account-readiness/${competitionId}/repair`, { body: {} });
        assert.equal(repair.status, 200, JSON.stringify(repair.data));
        assert.equal(repair.data.mode, 'soap_repaired');
        const expectedRepaired = [
            { loginRole: 'teacher', studentIndex: 1 },
            { loginRole: 'student', studentIndex: 1 }
        ];
        if (method === 'net') expectedRepaired.push({ loginRole: 'student', studentIndex: 2 });
        assert.deepEqual(repair.data.repaired, expectedRepaired);
        const expectedRepairOperations = [
            'IsGroupExisted', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted',
            'IsGroupExisted', 'IsStuExisted'
        ];
        if (method === 'net') expectedRepairOperations.push('IsGroupExisted', 'IsStuExisted', 'AddStudent');
        assert.deepEqual(operationNames(), expectedRepairOperations);
        const expectedReadyRows = [
            ['student', 1], ['teacher', 1]
        ];
        if (method === 'net') expectedReadyRows.splice(1, 0, ['student', 2]);
        assert.deepEqual((await statusRows()).map(row => [row.login_role, row.student_index]), expectedReadyRows);

        harness.platform.state.requests.length = 0;
        const verifiedAgain = await execute(competitionId);
        assert.equal(verifiedAgain.status, 200, JSON.stringify(verifiedAgain.data));
        assert.equal(verifiedAgain.data.accountWasReady, true);
        assert.deepEqual(operationNames(), []);
        assert.equal((await statusRows()).length, method === 'net' ? 3 : 2);
    });
}

test('student role cannot clear an account readiness marker', async () => {
    const { competitionId } = await routeConfig(officialConfig('commerce'));
    await harness.seedUser({ id: 2, username: 'e2e-student', role: 'student' });
    const studentToken = await harness.issueToken({ id: 2, username: 'e2e-student', role: 'student' });
    const response = await harness.api(`/api/sso/account-readiness/${competitionId}/repair`, {
        body: {}, headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert.equal(response.status, 403);
});

for (const [method, addGroupOperation] of [
    ['managementAccounting', 'AddTrainGroup'],
    ['crossBorderCommerce', 'AddGroup'],
    ['enterpriseManagement', 'AddTrainGroup']
]) {
    test(`official ${method} runs through the production route with its own profile`, async () => {
        const { competitionId } = await routeConfig(officialConfig(method));
        const [storedConfig] = await harness.rows(
            'SELECT sc.config_data AS configData FROM competitions c JOIN sso_configs sc ON sc.id = c.sso_config_id WHERE c.id = ?',
            competitionId
        );
        assert.equal(JSON.parse(storedConfig.configData).method, method);
        const response = await execute(competitionId);
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.deepEqual(operationNames(), [
            'IsGroupExisted', addGroupOperation, 'IsStuExisted', 'AddStudent'
        ]);
        assert.match(response.data.redirectUrl, /\/Login\.aspx\?type=itmc&data=[A-F0-9]+$/);
    });
}

test('official student-account deletion stays on the selected official adapter', async t => {
    for (const [method, expectedOperations] of [
        ['java', ['tokenInfo', 'delStudentDataQueue']],
        ['managementAccounting', ['MarkStuDeleted']]
    ]) {
        await t.test(method, async () => {
            await harness.reset();
            const { competitionId } = await routeConfig(officialConfig(method));
            await harness.run(
                `INSERT INTO user_competition_student_accounts
                 (user_id, competition_id, student_index, account_name, status)
                 VALUES (1, ?, 2, 'student-child-2', 'ready')`,
                competitionId
            );
            const response = await harness.api(`/api/sso/student-accounts/${competitionId}/2`, {
                method: 'DELETE'
            });
            assert.equal(response.status, 200, JSON.stringify(response.data));
            assert.deepEqual(operationNames(), expectedOperations);
            assert.deepEqual(await harness.rows(
                'SELECT * FROM user_competition_student_accounts WHERE competition_id = ?', competitionId
            ), []);
        });
    }
});

test('official SOAP teacher route and classType 1/2/3 use exact operations', async t => {
    for (const [classType, addOperation] of [[1, 'AddTrainGroup'], [2, 'AddAppraisalGroup'], [3, 'AddMegagameGroup']]) {
        await t.test(`classType ${classType}`, async () => {
            await harness.reset();
            const { competitionId } = await routeConfig(officialConfig('net', { classType }), { classType });
            const response = await execute(competitionId, { loginRole: 'teacher' });
            assert.equal(response.status, 200);
            assert.deepEqual(operationNames(), [
                'IsGroupExisted', addOperation, 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
            ]);
            assert.match(
                response.data.redirectUrl,
                /\/Login\.aspx\?type=itmc&data=[^&]+&needTheoryScore=1$/
            );
        });
    }
});

test('marketing production route sends the confirmed six AddStudent parameters', async () => {
    const { competitionId } = await routeConfig(officialConfig('marketing', { maxRunYear: 0, autoDeal: false }));
    await execute(competitionId);
    const request = harness.platform.state.requests.find(item => item.operationName === 'AddStudent');
    const xml = request.body;
    const tags = ['studentList', 'groupID', 'st', 'ed', 'maxRunYear', 'autoDeal'];
    let cursor = -1;
    for (const tag of tags) {
        const next = xml.indexOf(`<${tag}>`);
        assert.ok(next > cursor, `${tag} 参数顺序错误`);
        cursor = next;
    }
    assert.match(xml, /<maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
});

test('unknown SOAP existence response neither creates account nor writes readiness nor continues', async () => {
    harness.platform.queueSoap('IsStuExisted', success({ unexpected: true }));
    const { competitionId } = await routeConfig(officialConfig('net'));
    const response = await execute(competitionId);
    assert.equal(response.status, 500);
    assert.deepEqual(operationNames(), ['IsGroupExisted', 'AddTrainGroup', 'IsStuExisted']);
    assert.equal(operationNames().includes('AddStudent'), false);
    assert.equal(harness.platform.state.requests.some(item => item.method === 'GET'), false);
    assert.deepEqual(await statusRows(), []);
});

test('captured AddTeacher failure may continue per official behavior and only final success writes readiness', async () => {
    harness.platform.queueSoap('AddTeacher', success([], { code: 10010, succ: false, message: 'ignored by official' }));
    const { competitionId } = await routeConfig(officialConfig('net'));
    const response = await execute(competitionId, { loginRole: 'teacher' });
    assert.equal(response.status, 200);
    assert.deepEqual(operationNames(), [
        'IsGroupExisted', 'AddTrainGroup', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
    ]);
    assert.equal((await statusRows()).length, 1);
});

test('production SSE stages are idempotent across whole-method retry', async () => {
    harness.platform.queueJava('trainingExamPaper', [
        success(null, { code: 10011, succ: false }), success('retry ticket')
    ]);
    const { competitionId } = await routeConfig(officialConfig('java'));
    const response = await harness.api('/api/sso/execute/stream', {
        body: { competitionId, context: { loginRole: 'student' } }
    });
    assert.equal(response.status, 200);
    const stages = [...response.text.matchAll(/event: stage\ndata: (.+)/g)]
        .map(match => JSON.parse(match[1]).stage);
    assert.equal(stages.filter(stage => stage === 'check_connection').length, 1);
    assert.equal(stages.filter(stage => stage === 'check_class').length, 1);
    assert.equal(stages.filter(stage => stage === 'create_account').length, 1);
    assert.equal(stages.filter(stage => stage === 'prepare_entry').length, 1);
    assert.match(response.text, /event: result/);
});

test('responses, errors, dry-run and logs contain no credentials or platform token', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const dryRun = await execute(competitionId, {}, true);
    const successResponse = await execute(competitionId);
    const storedStatus = await statusRows();
    const auditValue = JSON.stringify({
        dryRun: dryRun.data,
        success: { ...successResponse.data, redirectUrl: '[REQUIRED-REDIRECT-REDACTED]' },
        logs: harness.logs,
        requests: harness.platform.state.requests.map(item => ({ ...item, body: '[REDACTED]' })),
        storedStatus
    });
    for (const secret of Object.values(E2E_SECRETS)) assert.doesNotMatch(auditValue, new RegExp(secret));
    assert.equal(storedStatus.length, 1);
});

test('official class remove deletes the remote class and marks the card ghost', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    harness.platform.queueSoap('IsGroupExisted', success('group-1'));
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.deleted, true);
    assert.equal(response.data.className, 'mce2e-admin');
    assert.deepEqual(
        harness.platform.state.requests.map(request => request.operationName),
        ['IsGroupExisted', 'DelGroup']
    );
    const rows = await harness.rows('SELECT user_id, competition_id FROM user_class_removals');
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), 1);
    assert.equal(Number(rows[0].competition_id), competitionId);
    const cards = await harness.api('/api/competitions');
    assert.equal(Number(cards.data.find(card => card.id === competitionId).classRemoved), 1);
});

test('official class remove is idempotent when the remote class does not exist', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.deleted, false);
    assert.deepEqual(
        harness.platform.state.requests.map(request => request.operationName),
        ['IsGroupExisted']
    );
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 1);
});

test('official class restore clears the ghost flag', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    harness.platform.queueSoap('IsGroupExisted', success('group-1'));
    await harness.api('/api/sso/class/remove', { body: { competitionId } });
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 1);

    const restore = await harness.api('/api/sso/class/restore', {
        body: { competitionId }
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.success, true);
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
    const cards = await harness.api('/api/competitions');
    assert.equal(Number(cards.data.find(card => card.id === competitionId).classRemoved), 0);
});

test('official class remove surfaces SOAP upstream failure as 502 with a visible message', async () => {
    const { competitionId } = await routeConfig(officialConfig('net'));
    harness.platform.queueSoap('IsGroupExisted', success('group-1'));
    harness.platform.queueSoap('DelGroup', { code: 10010, succ: false, message: '删除失败', data: null });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 502);
    assert.match(response.data.error, /远程班级删除失败/);
});

test('JAVA class remove deletes via the account-management API and marks the card ghost', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await seedAccountService();
    await bindClassDelete(competitionId);
    harness.platform.queueJava('delete', { success: true, results: [{ table: 'user_info', deletedRows: 3 }, { table: 'user_class', deletedRows: 1 }] });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.deleted, true);
    assert.equal(response.data.className, 'mce2e-admin');
    assert.ok(
        harness.platform.state.requests.some(request => request.path.endsWith('/api/v1/db/delete')),
        'expected a generic account-management db/delete request'
    );
    const rows = await harness.rows('SELECT user_id, competition_id FROM user_class_removals');
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), 1);
    assert.equal(Number(rows[0].competition_id), competitionId);
    const cards = await harness.api('/api/competitions');
    assert.equal(Number(cards.data.find(card => card.id === competitionId).classRemoved), 1);
});

test('JAVA class remove treats a missing class from the account-management API as idempotent', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await bindClassDelete(competitionId);
    harness.platform.queueJava('delete', { success: true, results: [{ table: 'user_info', deletedRows: 0 }, { table: 'user_class', deletedRows: 0 }] });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.deleted, false);
    const rows = await harness.rows('SELECT user_id, competition_id FROM user_class_removals');
    assert.equal(rows.length, 1);
});

test('JAVA class remove rejects when the card class-delete mapping is not enabled (toggle off)', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await bindClassDelete(competitionId, { ...CLASS_DELETE_MAPPING, enabled: false });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /未配置 Java 班级删除映射/);
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
});

test('JAVA class remove rejects when the card class-delete mapping is incomplete', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await bindClassDelete(competitionId, { ...CLASS_DELETE_MAPPING, classTable: '' });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 409);
    assert.match(response.data.error, /班级删除映射/);
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
});

test('JAVA class remove surfaces account-management executor failure as 502', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    await bindClassDelete(competitionId);
    harness.platform.queueJava('delete', { success: false, error: '数据库连接失败', code: 'db_error' });
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 502);
    assert.match(response.data.error, /数据库连接失败/);
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 0);
});

test('official class remove rejects direct methods', async () => {
    const { competitionId } = await routeConfig(officialConfig('direct'));
    const response = await harness.api('/api/sso/class/remove', {
        body: { competitionId }
    });
    assert.equal(response.status, 400);
    assert.match(response.data.error, /不支持远端删除班级/);
});

test('official module init reinitializes a JAVA platform and marks the card ghost', async () => {
    const { competitionId } = await routeConfig(officialConfig('java'));
    const confirm = await harness.api('/api/sso/module/init/confirm', {
        body: { competitionId }
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.data.success, true);
    assert.ok(confirm.data.confirmToken, '必须发放一次性确认令牌');
    harness.platform.queueJava('reinitializeSystem', success(true));
    const response = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: confirm.data.confirmToken }
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.success, true);
    assert.equal(response.data.initialized, true);
    const paths = harness.platform.state.requests.map(request => request.path);
    assert.ok(paths[0].endsWith('/open/tokenInfo'));
    assert.ok(paths.some(item => item.endsWith('/open/reinitializeSystem')));
    assert.equal((await harness.rows('SELECT * FROM user_class_removals')).length, 1);
    const replay = await harness.api('/api/sso/module/init', {
        body: { competitionId, confirmToken: confirm.data.confirmToken }
    });
    assert.equal(replay.status, 403, '一次性确认令牌消费后不得重放');
    assert.match(replay.data.error, /已使用/);
});

test('official module init rejects non-JAVA methods', async () => {
    for (const method of ['net', 'direct']) {
        const { competitionId } = await routeConfig(officialConfig(method));
        const response = await harness.api('/api/sso/module/init', {
            body: { competitionId }
        });
        assert.equal(response.status, 400);
        assert.match(response.data.error, /不支持模块初始化/);
    }
});
