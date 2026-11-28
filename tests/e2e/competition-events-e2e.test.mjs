import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { createProductionHarness, officialConfig } from './helpers/productionHarness.mjs';

const API = '/api/competition-events';
const SSO = '/api/sso/execute';
const PLATFORM_URL = 'http://localhost:9289/DS50108';
const CLASS_NAME = '模拟竞赛专用班级';
const accounts = {
    admin: { id: 11, username: 'event-admin', role: 'admin' },
    otherAdmin: { id: 12, username: 'event-other-admin', role: 'admin' },
    teacher: { id: 13, username: 'event-teacher', role: 'teacher' },
    otherTeacher: { id: 14, username: 'event-other-teacher', role: 'teacher' },
    disabledTeacher: { id: 15, username: 'event-disabled-teacher', role: 'teacher' },
    student: { id: 16, username: 'event-student', role: 'student' }
};
const headers = { anonymous: { Authorization: '' } };
let harness;

before(async () => {
    harness = await createProductionHarness();
    for (const [key, account] of Object.entries(accounts)) {
        await harness.seedUser(account);
        headers[key] = { Authorization: `Bearer ${await harness.issueToken(account)}` };
    }
    await harness.run('UPDATE users SET is_disabled = 1 WHERE id = ?', accounts.disabledTeacher.id);
});
beforeEach(async () => { await harness.reset(); });
after(async () => { await harness?.dispose(); });

function call(actor, path, body) {
    return harness.api(path, { headers: headers[actor], body });
}

async function cardFor(method = 'java', { url = PLATFORM_URL, classType = 1 } = {}) {
    const configId = await harness.seedConfig(officialConfig(method, { classType, officialBaseUrl: url }));
    return harness.seedCompetition({ configId, method, url, classType });
}

function eventInput(competitionId, teacherIds = [accounts.teacher.id], title = '校内模拟赛') {
    return { competitionId, teacherIds, title, className: CLASS_NAME, durationHours: 1, requestId: randomUUID() };
}

async function openEvent(actor, competitionId, teacherIds = [accounts.teacher.id], title = '校内模拟赛') {
    const response = await call(actor, API, eventInput(competitionId, teacherIds, title));
    assert.equal(response.status, 201, response.text);
    assert.equal(response.data.event.status, 'open', response.text);
    return response.data.event;
}

async function events(actor, pathname) {
    const response = await call(actor, `${API}${pathname}`);
    assert.equal(response.status, 200, response.text);
    return response.data.events;
}

function launch(actor, competitionId, competitionEventId, extras = {}) {
    return call(actor, SSO, { competitionId, competitionEventId, ...extras });
}

test('competition events are limited to management roles and inactive or non-teacher recipients are rejected atomically', async () => {
    const card = await cardFor();
    const direct = await harness.seedCompetition({ configId: null, method: 'direct', url: PLATFORM_URL });
    const agent = await harness.seedCompetition({ configId: null, method: 'paasV2', url: PLATFORM_URL });
    const input = eventInput(card);
    assert.equal((await call('anonymous', API, input)).status, 401);
    for (const actor of ['teacher', 'student']) {
        assert.equal((await call(actor, API, input)).status, 403);
        for (const path of ['/manage', '/cards', '/teachers']) {
            assert.equal((await call(actor, `${API}${path}`)).status, 403);
        }
    }
    assert.equal((await call('student', `${API}/mine`)).status, 403);
    assert.equal((await call('admin', `${API}/mine`)).status, 403);

    const available = await call('admin', `${API}/cards`);
    assert.equal(available.status, 200, available.text);
    assert.deepEqual(available.data.cards.map(item => item.id), [card]);
    const directory = await call('admin', `${API}/teachers`);
    assert.equal(directory.status, 200, directory.text);
    assert.deepEqual(new Set(directory.data.teachers.map(item => item.id)), new Set([accounts.teacher.id, accounts.otherTeacher.id]));

    for (const invalidId of [accounts.disabledTeacher.id, accounts.student.id, accounts.admin.id]) {
        const failed = await call('admin', API, { ...input, teacherIds: [accounts.teacher.id, invalidId] });
        assert.equal(failed.status, 400, failed.text);
    }
    assert.equal((await call('admin', API, { ...input, teacherIds: [accounts.teacher.id, accounts.teacher.id] })).status, 400);
    assert.equal((await call('admin', API, { ...input, className: '  ' })).status, 400);
    for (const excludedCard of [direct, agent]) {
        assert.equal((await call('admin', API, { ...input, competitionId: excludedCard })).status, 400);
    }
    assert.deepEqual(await events('admin', '/manage'), []);
    assert.deepEqual(harness.platform.state.requests, [], 'invalid requests must not contact the platform');

    const managed = await openEvent('admin', card, [accounts.teacher.id, accounts.otherTeacher.id]);
    const another = await openEvent('otherAdmin', card, [accounts.otherTeacher.id], '另一场比赛');
    const superEvent = await openEvent('superAdmin', card, [accounts.teacher.id], '超级管理员发起');
    assert.equal(managed.teacherCount, 2);
    assert.equal(managed.className, CLASS_NAME);
    assert.match(managed.platformClassName, /^[a-zA-Z0-9_-]+$/);
    assert.ok(managed.teacherAccountName);
    assert.equal(managed.canEnterTeacher, true);
    assert.equal(managed.canRetry, false);
    assert.deepEqual(new Set(managed.teacherNames), new Set([accounts.teacher.username, accounts.otherTeacher.username]));
    assert.deepEqual((await events('admin', '/manage')).map(item => item.id), [managed.id]);
    assert.deepEqual((await events('otherAdmin', '/manage')).map(item => item.id), [another.id]);
    const superVisible = await events('superAdmin', '/manage');
    assert.deepEqual(new Set(superVisible.map(item => item.id)), new Set([managed.id, another.id, superEvent.id]));
    assert.equal(superVisible.find(item => item.id === managed.id).canEnterTeacher, false);
    assert.equal(superVisible.find(item => item.id === superEvent.id).canEnterTeacher, true);
    assert.equal((await call('otherAdmin', `${API}/${managed.id}/close`, {})).status, 404);
    assert.notEqual(managed.platformClassName, another.platformClassName);
    assert.notEqual(managed.teacherAccountName, another.teacherAccountName);
    assert.deepEqual(await harness.rows('SELECT * FROM user_platform_account_status'), []);
});

test('only selected teachers see, acknowledge and enter an event, using its configured card', async () => {
    const card = await cardFor();
    const otherCard = await cardFor('java', { url: 'http://localhost:9289/another-entry' });
    const event = await openEvent('admin', card);
    const otherEvent = await openEvent('admin', otherCard, [accounts.otherTeacher.id]);
    const [notice] = await events('teacher', '/mine');
    assert.equal(notice.id, event.id);
    assert.equal(notice.title, event.title);
    assert.equal(notice.className, event.className);
    assert.equal(notice.competitionId, card);
    assert.equal(notice.seenAt, null);
    assert.equal(notice.enteredAt, null);
    assert.equal('teacherNames' in notice, false);
    assert.equal('teacherAccountName' in notice, false);
    assert.doesNotMatch(JSON.stringify(notice), /localhost|teacherAccountName|PASSWORD_E2E|PLATFORM_TOKEN_/);
    assert.deepEqual((await events('otherTeacher', '/mine')).map(item => item.id), [otherEvent.id]);
    assert.equal((await call('otherTeacher', `${API}/${event.id}/seen`, {})).status, 404);
    assert.equal((await launch('otherTeacher', card, event.id)).status, 404);
    assert.equal((await launch('student', card, event.id)).status, 404);
    assert.equal((await launch('teacher', otherCard, event.id)).status, 404);
    assert.equal((await launch('teacher', card, otherEvent.id)).status, 404);

    const list = await call('teacher', '/api/competitions');
    assert.equal(list.status, 200, list.text);
    assert.ok(!list.data.some(item => item.id === card), 'the invitation does not grant ordinary workbench access');
    const ordinary = await call('teacher', SSO, { competitionId: card, context: { loginRole: 'student' } });
    assert.equal(ordinary.status, 403, ordinary.text);

    const seen = await call('teacher', `${API}/${event.id}/seen`, {});
    assert.equal(seen.status, 200, seen.text);
    const [afterSeen] = await events('teacher', '/mine');
    assert.ok(afterSeen.seenAt);
    assert.equal(afterSeen.enteredAt, null);
    assert.equal((await call('teacher', `${API}/${event.id}/seen`, {})).status, 200);
    assert.equal((await events('teacher', '/mine'))[0].seenAt, afterSeen.seenAt);

    const entered = await launch('teacher', card, event.id);
    assert.equal(entered.status, 200, entered.text);
    assert.equal(new URL(entered.data.redirectUrl).pathname, '/DS50108/open/enterIndex');
    const [afterEntry] = await events('teacher', '/mine');
    assert.equal(afterEntry.seenAt, afterSeen.seenAt);
    assert.ok(Date.parse(afterEntry.enteredAt) >= Date.parse(afterEntry.createdAt));
    assert.equal((await events('otherTeacher', '/mine'))[0].enteredAt, null);
    assert.deepEqual(await harness.rows('SELECT * FROM user_platform_account_status'), []);
});

test('closing, expiring or removing teacher eligibility revokes event entry', async () => {
    const card = await cardFor();
    const closed = await openEvent('admin', card);
    const expired = await openEvent('admin', card);
    const remains = await openEvent('admin', card);
    const close = await call('superAdmin', `${API}/${closed.id}/close`, {});
    assert.equal(close.status, 200, close.text);
    assert.equal(close.data.event.status, 'closed');
    const now = Date.now();
    await harness.run('UPDATE competition_events SET created_at = ?, expires_at = ? WHERE id = ?', now - 5000, now - 1000, expired.id);

    assert.deepEqual((await events('teacher', '/mine')).map(item => item.id), [remains.id]);
    for (const inactive of [closed, expired]) {
        assert.equal((await launch('teacher', card, inactive.id)).status, 404);
        assert.equal((await launch('admin', card, inactive.id)).status, 404);
        assert.equal((await call('teacher', `${API}/${inactive.id}/seen`, {})).status, 404);
    }
    const inactive = (await events('admin', '/manage')).find(item => item.id === expired.id);
    assert.equal(inactive.status, 'expired');
    await harness.run('UPDATE competitions SET unlock_time = ? WHERE id = ?', new Date(now + 60000).toISOString(), card);
    const outsideWindow = await launch('teacher', card, remains.id);
    assert.equal(outsideWindow.status, 403, outsideWindow.text);
    await harness.run('UPDATE competitions SET unlock_time = NULL WHERE id = ?', card);

    await harness.run('UPDATE users SET role = ? WHERE id = ?', 'student', accounts.teacher.id);
    try {
        const revoked = await launch('teacher', card, remains.id);
        assert.equal(revoked.status, 404, revoked.text);
    } finally {
        await harness.run('UPDATE users SET role = ? WHERE id = ?', 'teacher', accounts.teacher.id);
    }
});

test('the publisher enters the dedicated Java teacher account and each invited teacher enters its own student in that class', async () => {
    const card = await cardFor('java', { classType: 3 });
    const event = await openEvent('admin', card, [accounts.teacher.id, accounts.otherTeacher.id]);
    const provisioning = harness.platform.state.requests.slice();
    const preparedStudents = provisioning.filter(item => item.operationName === 'getUserName');
    assert.ok(preparedStudents.length, 'Java must attach a participant to establish the remote class before publish');
    const classNames = new Set(preparedStudents.map(item => item.body.className));
    assert.deepEqual(classNames, new Set([event.platformClassName]));
    assert.deepEqual(new Set(preparedStudents.map(item => item.body.teacherUserName)), new Set([event.teacherAccountName]));
    assert.deepEqual(new Set(preparedStudents.map(item => item.body.classMode)), new Set(['3']));
    assert.ok(provisioning.some(item => item.operationName === 'getLoginTeacherName' && item.body.u === event.teacherAccountName));
    assert.notEqual(event.teacherAccountName, `mc${accounts.admin.username}`);

    for (const actor of ['otherAdmin', 'superAdmin', 'student']) {
        assert.ok([403, 404].includes((await launch(actor, card, event.id)).status));
    }
    const ordinarySuperEntry = await call('superAdmin', SSO, {
        competitionId: card,
        context: { loginRole: 'teacher', loginName: event.teacherAccountName }
    });
    assert.equal(ordinarySuperEntry.status, 403, ordinarySuperEntry.text);
    assert.equal(harness.platform.state.requests.length, provisioning.length);
    const teacherEntry = await launch('admin', card, event.id, {
        context: { loginRole: 'student', accountName: 'forged-account', className: 'forged-class' }
    });
    assert.equal(teacherEntry.status, 200, teacherEntry.text);
    const teacherUrl = new URL(teacherEntry.data.redirectUrl);
    assert.equal(teacherUrl.pathname, '/DS50108/open/teacherIndex');
    assert.equal(teacherUrl.searchParams.get('className'), event.platformClassName);
    assert.equal(teacherUrl.searchParams.get('classMode'), '3');
    assert.equal((await events('teacher', '/mine'))[0].enteredAt, null);

    const response = await call('teacher', `${SSO}/stream`, {
        competitionId: card, competitionEventId: event.id,
        context: { loginRole: 'teacher', studentIndex: 2, loginName: 'forged-account', className: 'forged-class' }
    });
    assert.equal(response.status, 200, response.text);
    const result = response.text.match(/^event: result\r?\ndata: (.+)$/m)?.[1];
    assert.ok(result, response.text);
    const studentEntry = JSON.parse(result).data;
    assert.equal(studentEntry.success, true);
    assert.equal(new URL(studentEntry.redirectUrl).pathname, '/DS50108/open/enterIndex');
    const otherEntry = await launch('otherTeacher', card, event.id);
    assert.equal(otherEntry.status, 200, otherEntry.text);
    const launches = harness.platform.state.requests.slice(provisioning.length);
    assert.deepEqual(launches.filter(item => item.operationName === 'getLoginTeacherName').map(item => item.body.u),
        [event.teacherAccountName]);
    const studentTickets = launches.filter(item => ['trainingExamPaper', 'trainingExamPaperV2'].includes(item.operationName));
    assert.equal(studentTickets.length, 2);
    assert.notEqual(studentTickets[0].body.u, studentTickets[1].body.u);
    assert.notEqual(studentTickets[0].body.u, `mcs${accounts.teacher.username}1`);
    const synchronized = [...preparedStudents, ...launches.filter(item => item.operationName === 'getUserName')];
    assert.deepEqual(new Set(studentTickets.map(item => item.body.u)), new Set(synchronized.map(item => item.body.u)));
    assert.ok(synchronized.every(item => item.body.className === event.platformClassName
        && item.body.teacherUserName === event.teacherAccountName && item.body.classMode === '3'));
    assert.doesNotMatch(JSON.stringify(launches), /forged-account|forged-class/);
    assert.ok((await events('teacher', '/mine'))[0].enteredAt);
    assert.ok((await events('otherTeacher', '/mine'))[0].enteredAt);
    assert.deepEqual(await harness.rows('SELECT * FROM user_platform_account_status'), []);
});

test('replacing the card entry disables existing invitations', async () => {
    const card = await cardFor();
    const event = await openEvent('admin', card);
    const requestCount = harness.platform.state.requests.length;
    await harness.run('UPDATE competitions SET url = ? WHERE id = ?', 'http://localhost:9289/replaced-entry', card);
    assert.deepEqual(await events('teacher', '/mine'), []);
    assert.equal((await launch('teacher', card, event.id)).status, 404);
    const [managed] = await events('admin', '/manage');
    assert.equal(managed.status, 'inactive');
    assert.doesNotMatch(JSON.stringify(managed), /replaced-entry|card_binding/);
    assert.equal(harness.platform.state.requests.length, requestCount);
});

test('a SOAP contest creates a dedicated group and binds its teacher and roster to the same group', async () => {
    const card = await cardFor('net', { classType: 3 });
    const event = await openEvent('admin', card, [accounts.teacher.id, accounts.otherTeacher.id]);
    const requests = harness.platform.state.requests.slice();
    const groupID = harness.platform.state.groups.get(event.platformClassName);
    assert.ok(groupID);
    assert.equal(harness.platform.state.groups.size, 1);
    assert.equal(requests.filter(item => item.operationName === 'AddMegagameGroup').length, 1);
    const teacherCreate = requests.find(item => item.operationName === 'AddTeacher');
    assert.ok(teacherCreate.body.includes(`>${groupID}<`));
    assert.ok(teacherCreate.body.includes(`>${event.teacherAccountName}<`));
    const studentCreates = requests.filter(item => item.operationName === 'AddStudent');
    assert.ok(studentCreates.length);
    assert.ok(studentCreates.every(item => item.body.includes(`>${groupID}<`)));
    const studentPassword = /<StudentBaseClass><StudentID>[^<]+<\/StudentID><Password>([^<]+)<\/Password>/g;
    const passwords = studentCreates.flatMap(item => [...item.body.matchAll(studentPassword)].map(match => match[1]));
    assert.equal(new Set(passwords).size, 2);
    assert.ok(passwords.every(password => !password.startsWith('train_123')));
    assert.equal(harness.platform.state.students.size, 2);
    assert.ok(!harness.platform.state.students.has(`mcs${accounts.teacher.username}1`));
    const teacherEntry = await launch('admin', card, event.id);
    const studentEntry = await launch('teacher', card, event.id);
    assert.equal(teacherEntry.status, 200, teacherEntry.text);
    assert.equal(studentEntry.status, 200, studentEntry.text);
    assert.ok(new URL(teacherEntry.data.redirectUrl).searchParams.has('needTheoryScore'));
    assert.ok(!new URL(studentEntry.data.redirectUrl).searchParams.has('needTheoryScore'));
    assert.notEqual(teacherEntry.data.redirectUrl, studentEntry.data.redirectUrl);
    assert.deepEqual(await harness.rows('SELECT * FROM user_platform_account_status'), []);
});

test('an unconfirmed provider account blocks invitations and retry reuses the same event and class', async () => {
    const card = await cardFor('net', { classType: 3 });
    const input = eventInput(card);
    // Some vendor responses report success without confirming the requested account.
    harness.platform.queueSoap('AddTeacher', { code: 10000, succ: true, message: 'no account confirmed', data: [] });
    const rejected = await call('admin', API, input);
    assert.equal(rejected.status, 502, rejected.text);

    const [failed] = await events('admin', '/manage');
    assert.ok(failed, 'failed provisioning must be recorded for recovery');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.canRetry, true);
    assert.equal(failed.canEnterTeacher, false);
    assert.equal(harness.platform.state.groups.size, 1);
    const groupID = harness.platform.state.groups.get(failed.platformClassName);
    assert.ok(groupID);
    assert.deepEqual(await events('teacher', '/mine'), []);
    for (const actor of ['admin', 'teacher']) {
        assert.ok([403, 404, 409].includes((await launch(actor, card, failed.id)).status));
    }
    assert.ok([403, 404].includes((await call('otherAdmin', `${API}/${failed.id}/prepare`, {})).status));

    const retry = await call('superAdmin', `${API}/${failed.id}/prepare`, {});
    assert.ok([200, 201].includes(retry.status), retry.text);
    const [recovered] = await events('admin', '/manage');
    assert.equal(recovered.id, failed.id);
    assert.equal(recovered.status, 'open');
    assert.equal(recovered.platformClassName, failed.platformClassName);
    assert.equal(recovered.teacherAccountName, failed.teacherAccountName);
    assert.equal(harness.platform.state.groups.get(recovered.platformClassName), groupID);
    assert.equal(harness.platform.state.groups.size, 1);
    const [notice] = await events('teacher', '/mine');
    assert.equal(notice.id, recovered.id);

    const requestCount = harness.platform.state.requests.length;
    const repeated = await call('admin', API, input);
    assert.ok([200, 201].includes(repeated.status), repeated.text);
    assert.equal(repeated.data.event.id, recovered.id);
    assert.equal((await call('admin', API, { ...input, className: '被修改的班级' })).status, 409);
    assert.equal(harness.platform.state.requests.length, requestCount, 'replayed publish must not reprovision');
    assert.equal((await events('admin', '/manage')).length, 1);
});

test('ordinary card access cannot impersonate a contest teacher or student account', async () => {
    const card = await cardFor();
    const event = await openEvent('admin', card);
    const contestStudent = harness.platform.state.requests.find(item => item.operationName === 'getUserName').body.u;
    await harness.run('INSERT INTO user_access_policies (user_id, configured) VALUES (?, 1)', accounts.otherTeacher.id);
    await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?)', accounts.otherTeacher.id, card);
    const requestCount = harness.platform.state.requests.length;

    const forged = {
        className: event.platformClassName, teacherUserName: event.teacherAccountName,
        accountName: contestStudent, studentList: [contestStudent]
    };
    const teacherEntry = await call('otherTeacher', SSO, {
        competitionId: card, context: { ...forged, loginRole: 'teacher', loginName: event.teacherAccountName }
    });
    const studentEntry = await call('otherTeacher', SSO, {
        competitionId: card, context: { ...forged, loginRole: 'student', loginName: contestStudent }
    });
    assert.equal(teacherEntry.status, 200, teacherEntry.text);
    assert.equal(studentEntry.status, 200, studentEntry.text);
    const ordinaryClass = `mc${accounts.otherTeacher.username}`;
    const ordinaryStudent = `mcs${accounts.otherTeacher.username}1`;
    assert.equal(new URL(teacherEntry.data.redirectUrl).searchParams.get('className'), ordinaryClass);
    const requests = harness.platform.state.requests.slice(requestCount);
    assert.deepEqual(requests.filter(item => item.operationName === 'getLoginTeacherName').map(item => item.body.u), [ordinaryClass]);
    assert.deepEqual(requests.filter(item => item.operationName === 'trainingExamPaper').map(item => item.body.u), [ordinaryStudent]);
    const serialized = JSON.stringify(requests.map(item => item.body));
    for (const name of [event.platformClassName, event.teacherAccountName, contestStudent]) assert.ok(!serialized.includes(name));
});
