import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createProductionHarness, E2E_SECRETS } from '../../e2e/helpers/productionHarness.mjs';

function decryptExpertPayload(value) {
    const decipher = crypto.createDecipheriv(
        'aes-128-ecb',
        Buffer.from('itmc_token_users', 'utf8'),
        null
    );
    return Buffer.concat([
        decipher.update(Buffer.from(value, 'base64')),
        decipher.final()
    ]).toString('utf8');
}

test('Java evaluator entry provisions the primary student and builds the original jump', async () => {
    const harness = await createProductionHarness();
    try {
        const configId = await harness.seedConfig({
            method: 'java',
            officialBaseUrl: 'http://localhost:9289/DS50108',
            officialBaseUrlConfirmed: true,
            allowHttp: true,
            classPrefix: 'mc',
            teacherPrefix: 'mc',
            studentPrefix: 'mcs',
            studentSuffix: '1',
            expertPrefix: 'judge-',
            tokenNumber: E2E_SECRETS.tokenNumber,
            tokenPassword: E2E_SECRETS.tokenPassword,
            roleName: 'student',
            flag: '1',
            trainOrExam: 'train'
        });
        const competitionId = await harness.seedCompetition({ configId, method: 'java' });
        for (const studentIndex of [2, 3, 4]) {
            await harness.run(
                `INSERT INTO user_competition_student_accounts
                    (user_id, competition_id, student_index, account_name, status)
                 VALUES (1, ?, ?, ?, 'ready')`,
                competitionId, studentIndex, `mcse2e-admin${studentIndex}`
            );
        }
        const first = await harness.api(`/api/sso/expert-accounts/${competitionId}`, { method: 'POST', body: {} });
        assert.equal(first.status, 200);
        assert.equal(first.data.success, true);
        assert.equal(first.data.account.accountName, 'judge-e2e-admin');
        assert.deepEqual(first.data.account.studentAccountNames, [
            'mcse2e-admin1', 'mcse2e-admin2', 'mcse2e-admin3', 'mcse2e-admin4'
        ]);
        assert.equal(first.data.account.boundStudentCount, 4);
        assert.equal(first.data.account.newlyBoundStudentCount, 1);
        assert.deepEqual(first.data.remoteProvisioning, {
            method: 'java',
            entry: 'open/toExpertPage',
            remoteProvisioning: 'vendor-entry',
            createsIndependentAccount: true,
            accountRole: 4,
            association: 'ExpertService.doInitExpert'
        });

        const redirect = new URL(first.data.redirectUrl);
        assert.equal(redirect.pathname, '/DS50108/open/toExpertPage');
        assert.equal(
            decryptExpertPayload(redirect.searchParams.get('expertuserdata')),
            'mcse2e-admin1=judge-e2e-admin'
        );
        assert.equal((await harness.rows(
            `SELECT account_name AS accountName FROM user_competition_expert_accounts
             WHERE user_id = 1 AND competition_id = ?`, competitionId
        ))[0].accountName, 'judge-e2e-admin');
        assert.deepEqual(await harness.rows(
            `SELECT student_index AS studentIndex, student_account_name AS studentAccountName
             FROM user_competition_expert_student_bindings
             WHERE user_id = 1 AND competition_id = ? ORDER BY student_index`, competitionId
        ), []);

        const second = await harness.api(`/api/sso/expert-accounts/${competitionId}`, { method: 'POST', body: {} });
        assert.equal(second.status, 200);
        assert.equal(second.data.redirectUrl, first.data.redirectUrl);
        assert.equal(second.data.account.newlyBoundStudentCount, 0);
        assert.equal(
            decryptExpertPayload(new URL(second.data.redirectUrl).searchParams.get('expertuserdata')),
            'mcse2e-admin1=judge-e2e-admin'
        );
    } finally {
        await harness.dispose();
    }
});

test('evaluator targets use the selected card platform accounts instead of MarchCenter class membership', async () => {
    const harness = await createProductionHarness();
    try {
        const teacher = { id: 20, username: 'teacher-roster', role: 'teacher' };
        await harness.seedUser(teacher);
        const classResult = await harness.run(
            `INSERT INTO classes (name, teacher_user_id, created_by)
             VALUES ('评委名单班', ?, 1)`,
            teacher.id
        );
        const classId = Number(classResult.meta.last_row_id);
        await harness.run('UPDATE users SET class_id = ? WHERE id = ?', classId, teacher.id);
        for (const [offset, username] of ['student-a', 'student-b', 'student-c', 'student-d'].entries()) {
            const studentId = 30 + offset;
            await harness.seedUser({ id: studentId, username, role: 'student' });
            await harness.run('UPDATE users SET class_id = ? WHERE id = ?', classId, studentId);
        }
        await harness.seedUser({ id: 40, username: 'disabled-student', role: 'student' });
        await harness.run('UPDATE users SET class_id = ?, is_disabled = 1 WHERE id = 40', classId);

        const configId = await harness.seedConfig({
            method: 'java',
            officialBaseUrl: 'http://localhost:9289/DS50108',
            officialBaseUrlConfirmed: true,
            allowHttp: true,
            classPrefix: 'mc', teacherPrefix: 'mc', studentPrefix: 'mcs', studentSuffix: '1',
            expertPrefix: 'judge-', tokenNumber: E2E_SECRETS.tokenNumber,
            tokenPassword: E2E_SECRETS.tokenPassword, roleName: 'student', flag: '1',
            trainOrExam: 'train'
        });
        const competitionId = await harness.seedCompetition({ configId, method: 'java' });
        for (const studentIndex of [2, 3, 4]) {
            await harness.run(
                `INSERT INTO user_competition_student_accounts
                    (user_id, competition_id, student_index, account_name, status)
                 VALUES (?, ?, ?, ?, 'ready')`,
                teacher.id, competitionId, studentIndex, `remote-teacher-${studentIndex}`
            );
        }
        await harness.run(
            `INSERT INTO user_access_policies (user_id, configured) VALUES (?, 1)`,
            teacher.id
        );
        await harness.run(
            `INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?)`,
            teacher.id, competitionId
        );
        const teacherToken = await harness.issueToken(teacher);
        const requestAsTeacher = async (pathname, options = {}) => {
            const response = await harness.miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, {
                method: options.method || (options.body === undefined ? 'GET' : 'POST'),
                headers: {
                    Authorization: `Bearer ${teacherToken}`,
                    ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
                },
                body: options.body === undefined ? undefined : JSON.stringify(options.body)
            });
            return { response, status: response.status, data: await response.json() };
        };

        const selected = await requestAsTeacher(`/api/sso/expert-accounts/${competitionId}`, {
            body: { studentIndex: 3 }
        });
        assert.equal(selected.status, 200);
        assert.equal(selected.data.account.selectedStudentIndex, 3);
        assert.equal(selected.data.account.studentAccountName, 'remote-teacher-3');
        assert.deepEqual(selected.data.account.studentAccountNames, [
            'mcsteacher-roster1', 'remote-teacher-2', 'remote-teacher-3', 'remote-teacher-4'
        ]);
        assert.equal(
            decryptExpertPayload(new URL(selected.data.redirectUrl).searchParams.get('expertuserdata')),
            'remote-teacher-3=judge-teacher-roster'
        );

        const missingPlatformAccount = await requestAsTeacher(`/api/sso/expert-accounts/${competitionId}`, {
            body: { studentIndex: 5 }
        });
        assert.equal(missingPlatformAccount.status, 404);
        assert.match(missingPlatformAccount.data.error, /目标平台/);
    } finally {
        await harness.dispose();
    }
});

test('.NET evaluator entry provisions through SOAP and builds the legacy evaluator jump', async () => {
    const harness = await createProductionHarness();
    try {
        const configId = await harness.seedConfig({
            method: 'net',
            officialBaseUrl: 'http://localhost:9289/DS50108',
            officialBaseUrlConfirmed: true,
            allowHttp: true,
            classPrefix: 'mc',
            teacherPrefix: 'mc',
            studentPrefix: 'mcs',
            studentSuffix: '1',
            soapUsername: E2E_SECRETS.soapUsername,
            soapPassword: E2E_SECRETS.soapPassword,
            ticketType: 'itmc',
            roleName: 'student',
            trainOrExam: 'train'
        });
        const competitionId = await harness.seedCompetition({ configId, method: 'net' });
        for (const studentIndex of [2, 3, 4]) {
            await harness.run(
                `INSERT INTO user_competition_student_accounts
                    (user_id, competition_id, student_index, account_name, status)
                 VALUES (1, ?, ?, ?, 'ready')`,
                competitionId, studentIndex, `mcse2e-admin${studentIndex}`
            );
        }
        const first = await harness.api(`/api/sso/expert-accounts/${competitionId}`, { method: 'POST', body: {} });
        assert.equal(first.status, 200);
        assert.equal(first.data.success, true);
        assert.equal(first.data.account.accountName, 'mcpwe2e-admin');
        assert.equal(first.data.account.boundStudentCount, 4);
        assert.equal(first.data.account.newlyBoundStudentCount, 1);
        assert.deepEqual(first.data.remoteProvisioning, {
            method: 'net',
            entry: 'login.aspx?op=expertlogin',
            remoteProvisioning: 'vendor-defined',
            createsIndependentAccount: null,
            accountRole: null,
            association: 'vendor-defined'
        });

        const redirect = new URL(first.data.redirectUrl);
        assert.equal(redirect.pathname, '/DS50108/login.aspx');
        assert.equal(redirect.searchParams.get('op'), 'expertlogin');
        assert.deepEqual(JSON.parse(redirect.searchParams.get('expertuserdata')), {
            ServerConfig: 'itmc',
            ExpertName: 'mcpwe2e-admin',
            UserName: 'mcse2e-admin1'
        });
        assert.equal((await harness.rows(
            `SELECT account_name AS accountName FROM user_competition_expert_accounts
             WHERE user_id = 1 AND competition_id = ?`, competitionId
        ))[0].accountName, 'mcpwe2e-admin');
        assert.ok(harness.platform.state.requests.some(request => request.operationName === 'AddStudent'));
        const expertRequests = harness.platform.state.requests.filter(request => (
            request.method === 'GET'
            && request.path.endsWith('/login.aspx')
            && new URLSearchParams(request.search).get('op') === 'loaduserscore'
        ));
        assert.deepEqual(expertRequests.map(request => (
            new URLSearchParams(request.search).get('usernames')
        )), ['mcse2e-admin1']);
        assert.equal((await harness.rows(
            `SELECT COUNT(*) AS count FROM user_competition_expert_student_bindings
             WHERE user_id = 1 AND competition_id = ?`, competitionId
        ))[0].count, 0);

        const selectedTicketRequestsAfterFirst = harness.platform.state.requests.filter(request => (
            request.method === 'GET'
            && request.path.endsWith('/login.aspx')
            && new URLSearchParams(request.search).get('op') === 'loaduserscore'
            && new URLSearchParams(request.search).get('usernames') === 'mcse2e-admin1'
        )).length;
        const second = await harness.api(`/api/sso/expert-accounts/${competitionId}`, { method: 'POST', body: {} });
        assert.equal(second.status, 200);
        assert.equal(second.data.redirectUrl, first.data.redirectUrl);
        assert.equal(second.data.account.newlyBoundStudentCount, 0);
        assert.equal(harness.platform.state.requests.filter(request => (
            request.method === 'GET'
            && request.path.endsWith('/login.aspx')
            && new URLSearchParams(request.search).get('op') === 'loaduserscore'
            && new URLSearchParams(request.search).get('usernames') === 'mcse2e-admin1'
        )).length, selectedTicketRequestsAfterFirst + 1);

        await harness.run(
            `INSERT INTO user_competition_student_accounts
                (user_id, competition_id, student_index, account_name, status)
             VALUES (1, ?, 5, 'mcse2e-admin5', 'ready')`,
            competitionId
        );
        await harness.run(
            `INSERT INTO user_platform_account_status
                (user_id, competition_id, login_role, student_index)
             VALUES (1, ?, 'student', 5)`,
            competitionId
        );
        const fifthTicketRequestsBefore = harness.platform.state.requests.filter(request => (
            request.method === 'GET'
            && request.path.endsWith('/login.aspx')
            && new URLSearchParams(request.search).get('op') === 'loaduserscore'
            && new URLSearchParams(request.search).get('usernames') === 'mcse2e-admin5'
        )).length;
        const third = await harness.api(`/api/sso/expert-accounts/${competitionId}`, {
            method: 'POST', body: { studentIndex: 5 }
        });
        assert.equal(third.status, 200);
        assert.equal(third.data.account.boundStudentCount, 5);
        assert.equal(third.data.account.newlyBoundStudentCount, 0);
        assert.equal(harness.platform.state.requests.filter(request => (
            request.method === 'GET'
            && request.path.endsWith('/login.aspx')
            && new URLSearchParams(request.search).get('op') === 'loaduserscore'
            && new URLSearchParams(request.search).get('usernames') === 'mcse2e-admin5'
        )).length, fifthTicketRequestsBefore + 1);
        assert.equal(JSON.parse(new URL(third.data.redirectUrl).searchParams.get('expertuserdata')).UserName, 'mcse2e-admin5');
    } finally {
        await harness.dispose();
    }
});
