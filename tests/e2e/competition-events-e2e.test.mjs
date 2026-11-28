import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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

async function cardSelections(actor) {
    const response = await call(actor, `${API}/cards`);
    assert.equal(response.status, 200, response.text);
    return new Map(response.data.cards.map(card => [card.id, card.ssoSelection]));
}

async function netProfile(name, soapUsername, options = {}) {
    const id = await harness.seedConfig(officialConfig('net', { soapUsername, ...options }), { name });
    return { id, name, method: 'net' };
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

test('an explicit card binding uses the exact system profile instead of a newer profile for the same method', async () => {
    const bound = await netProfile('卡片原有配置', 'bound-contest-credential');
    const newer = await netProfile('较新的同类配置', 'different-contest-credential');
    const card = await harness.seedCompetition({ configId: bound.id, method: 'net', url: PLATFORM_URL, classType: 3 });

    const selection = (await cardSelections('admin')).get(card);
    assert.deepEqual(selection, { mode: 'auto', profile: bound });
    assert.doesNotMatch(JSON.stringify(selection), /bound-contest-credential|SOAP_PASSWORD_E2E|localhost/);
    const forged = await call('admin', API, { ...eventInput(card), ssoConfigId: newer.id });
    assert.ok([400, 409].includes(forged.status), forged.text);
    assert.deepEqual(harness.platform.state.requests, []);

    const event = await openEvent('admin', card);
    assert.deepEqual(event.ssoConfiguration, bound);
    assert.ok(harness.platform.state.requests.length > 0);
    assert.ok(harness.platform.state.requests.every(request => /<Uname>bound-contest-credential<\/Uname>/.test(request.body)));
    const [stored] = await harness.rows('SELECT platform_sso_config_id, platform_sso_method FROM competition_events WHERE id = ?', event.id);
    assert.deepEqual(stored, { platform_sso_config_id: bound.id, platform_sso_method: 'net' });
    assert.equal((await launch('admin', card, event.id)).status, 200);
    assert.equal((await launch('teacher', card, event.id)).status, 200);

    const requestCount = harness.platform.state.requests.length;
    await harness.run('UPDATE sso_configs SET config_data = ? WHERE id = ?', JSON.stringify(officialConfig('java')), bound.id);
    assert.deepEqual(await events('teacher', '/mine'), []);
    assert.equal((await launch('teacher', card, event.id)).status, 404);
    assert.equal((await events('admin', '/manage'))[0].status, 'inactive');
    assert.equal(harness.platform.state.requests.length, requestCount);
});

test('an ambiguous same-method card requires an approved selection and keeps it through preparation retry', async () => {
    const initial = await netProfile('原免密配置', 'original-contest-credential');
    const card = await harness.seedCompetition({ configId: null, method: 'net', url: PLATFORM_URL, classType: 3 });
    assert.deepEqual((await cardSelections('admin')).get(card), { mode: 'auto', profile: initial });

    const selected = await netProfile('备用免密配置', 'selected-contest-credential');
    const canary = await netProfile('仅诊断配置', 'canary-contest-credential', { canaryOnly: true });
    const selection = (await cardSelections('admin')).get(card);
    assert.equal(selection.mode, 'manual');
    assert.deepEqual(selection.profiles.toSorted((a, b) => a.id - b.id), [initial, selected]);
    for (const input of [eventInput(card), { ...eventInput(card), ssoConfigId: canary.id }]) {
        const rejected = await call('admin', API, input);
        assert.ok([400, 409].includes(rejected.status), rejected.text);
    }
    assert.deepEqual(harness.platform.state.requests, []);

    harness.platform.queueSoap('AddTeacher', { code: 10010, succ: false, message: 'test preparation failure', data: [] });
    const submission = { ...eventInput(card), ssoConfigId: selected.id };
    const initialFailure = await call('admin', API, submission);
    assert.equal(initialFailure.status, 502, initialFailure.text);
    const [failed] = await events('admin', '/manage');
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.ssoConfiguration, selected);
    const requestCount = harness.platform.state.requests.length;
    assert.equal((await call('admin', API, { ...submission, ssoConfigId: initial.id })).status, 409);
    assert.equal(harness.platform.state.requests.length, requestCount);

    await netProfile('后来加入的同类配置', 'latest-contest-credential');
    const retry = await call('admin', `${API}/${failed.id}/prepare`, {});
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.data.event.status, 'open');
    assert.equal(retry.data.event.platformClassName, failed.platformClassName);
    assert.deepEqual(retry.data.event.ssoConfiguration, selected);
    assert.ok(harness.platform.state.requests.every(request => /<Uname>selected-contest-credential<\/Uname>/.test(request.body)));
    assert.equal((await launch('teacher', card, failed.id)).status, 200);

    await harness.run('DELETE FROM sso_configs WHERE id = ?', selected.id);
    const before = harness.platform.state.requests.length;
    assert.equal((await launch('teacher', card, failed.id)).status, 404);
    assert.equal((await events('admin', '/manage'))[0].status, 'inactive');
    assert.equal(harness.platform.state.requests.length, before);
});

test('a failed competition created before profile pinning can retry with its original card binding', async () => {
    const bound = await netProfile('原卡片免密配置', 'legacy-contest-credential');
    await netProfile('后来添加的同类配置', 'different-contest-credential');
    const card = await harness.seedCompetition({ configId: bound.id, method: 'net', url: PLATFORM_URL, classType: 3 });
    const eventId = randomUUID();
    const now = Date.now();
    // The original schema fingerprint recorded the card and only filled fallback fields for cards without a method.
    const legacyBinding = createHash('sha256')
        .update(JSON.stringify([PLATFORM_URL, 'net', bound.id, 3, null, null])).digest('hex');
    await harness.run(`INSERT INTO competition_events (id, competition_id, card_binding, title, class_name,
        duration_hours, created_by, created_at, expires_at, preparation_failed_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        eventId, card, legacyBinding, '先前创建失败的竞赛', CLASS_NAME, accounts.admin.id, now, now + 3_600_000, now);
    await harness.run('INSERT INTO competition_event_teachers (event_id, teacher_id) VALUES (?, ?)', eventId, accounts.teacher.id);
    assert.equal((await events('admin', '/manage'))[0].canRetry, true);
    assert.deepEqual(await events('teacher', '/mine'), []);

    const retry = await call('admin', `${API}/${eventId}/prepare`, {});
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.data.event.status, 'open');
    assert.equal(retry.data.event.id, eventId);
    assert.ok(harness.platform.state.requests.length > 0);
    assert.ok(harness.platform.state.requests.every(request => /<Uname>legacy-contest-credential<\/Uname>/.test(request.body)));
    assert.equal((await launch('teacher', card, eventId)).status, 200);
});

test('unbound cards use exact project associations and cannot send platform credentials to an unapproved sibling URL', async () => {
    const net = await netProfile('已关联的 .NET 配置', 'approved-contest-credential');
    await harness.seedCompetition({ configId: net.id, method: 'net', url: PLATFORM_URL });
    const sameProject = await harness.seedCompetition({ configId: null, method: null, url: PLATFORM_URL });
    const siblingUrl = `${PLATFORM_URL}/not-approved`;
    const sibling = await harness.seedCompetition({ configId: null, method: null, url: siblingUrl });

    let selections = await cardSelections('admin');
    assert.deepEqual(selections.get(sameProject), { mode: 'auto', profile: net });
    assert.equal(selections.has(sibling), false);
    const rejected = await call('admin', API, { ...eventInput(sibling), ssoConfigId: net.id });
    assert.ok([400, 403, 409].includes(rejected.status), rejected.text);
    assert.deepEqual(harness.platform.state.requests, []);
    assert.deepEqual(await events('admin', '/manage'), []);

    const java = {
        id: await harness.seedConfig(officialConfig('java'), { name: '已关联的 Java 配置' }),
        name: '已关联的 Java 配置',
        method: 'java'
    };
    await harness.seedCompetition({ configId: java.id, method: 'java', url: PLATFORM_URL });
    selections = await cardSelections('admin');
    assert.equal(selections.get(sameProject).mode, 'manual');
    assert.deepEqual(new Set(selections.get(sameProject).profiles.map(profile => profile.id)), new Set([net.id, java.id]));
    const recognized = await call('admin', API, { ...eventInput(sameProject), ssoConfigId: java.id });
    assert.equal(recognized.status, 201, recognized.text);
    assert.deepEqual(recognized.data.event.ssoConfiguration, java);
    const launchResponse = await launch('teacher', sameProject, recognized.data.event.id);
    assert.equal(launchResponse.status, 200, launchResponse.text);
    assert.equal(new URL(launchResponse.data.redirectUrl).pathname, '/DS50108/open/enterIndex');
    assert.ok(harness.platform.state.requests.every(request => request.path.startsWith('/DS50108/open/')));

    const superSelection = (await cardSelections('superAdmin')).get(sibling);
    assert.equal(superSelection.mode, 'manual');
    assert.ok(superSelection.profiles.some(profile => profile.id === net.id));
    const firstSiblingRequest = harness.platform.state.requests.length;
    const reviewed = await call('superAdmin', API, { ...eventInput(sibling), ssoConfigId: net.id });
    assert.equal(reviewed.status, 201, reviewed.text);
    assert.deepEqual(reviewed.data.event.ssoConfiguration, net);
    const siblingRequests = harness.platform.state.requests.slice(firstSiblingRequest);
    assert.ok(siblingRequests.length > 0);
    assert.ok(siblingRequests.every(request => request.path.startsWith('/DS50108/not-approved/')));
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
    assert.match(rejected.data.error, /创建教师账号.*平台返回码 10000/);
    assert.doesNotMatch(rejected.data.error, /no account confirmed|AddTeacher/);

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
