import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let harness;
let firstCard;
let secondCard;
let selectedTeacher;
const WINDOW = { unlockTime: '2027-01-01T00:00:00.000Z', lockTime: '2027-02-01T00:00:00.000Z' };
const teacher = (username, access = {}) => ({ username, email: `${username}@example.invalid`, password: 'Initial-password-1', role: 'teacher', ...access });

before(async () => {
    harness = await createProductionHarness();
    firstCard = await harness.seedCompetition({ configId: null, method: 'direct' });
    secondCard = await harness.seedCompetition({ configId: null, method: 'direct' });
});
after(async () => { await harness?.dispose(); });

test('batch creation saves each teacher whitelist and time rules with the account, including an explicit empty whitelist', async () => {
    const result = await harness.api('/api/users/batch', { body: { users: [
        teacher('selected-teacher', { permissions: [firstCard, firstCard], timeRules: { [firstCard]: WINDOW } }),
        teacher('empty-teacher', { permissions: [], timeRules: {} })
    ] } });
    assert.equal(result.status, 201, result.text);
    assert.equal(result.data.count, 2);
    selectedTeacher = result.data.users.find(user => user.username === 'selected-teacher');
    const emptyTeacher = result.data.users.find(user => user.username === 'empty-teacher');
    assert.deepEqual(await harness.rows('SELECT competition_id FROM user_permissions WHERE user_id = ?', selectedTeacher.id), [{ competition_id: firstCard }]);
    assert.deepEqual(await harness.rows('SELECT unlock_time, lock_time FROM user_competition_time_rules WHERE user_id = ?', selectedTeacher.id), [{ unlock_time: WINDOW.unlockTime, lock_time: WINDOW.lockTime }]);
    assert.deepEqual(await harness.rows('SELECT competition_id FROM user_permissions WHERE user_id = ?', emptyTeacher.id), []);
    assert.deepEqual(await harness.rows('SELECT configured FROM user_access_policies WHERE user_id = ?', emptyTeacher.id), [{ configured: 1 }]);
    assert.ok(selectedTeacher.classId);
});

test('omitted access fields retain legacy defaults rather than being confused with an empty list', async () => {
    const result = await harness.api('/api/users/batch', { body: { users: [teacher('legacy-default-teacher')] } });
    assert.equal(result.status, 201, result.text);
    assert.deepEqual((await harness.rows('SELECT competition_id FROM user_permissions WHERE user_id = ? ORDER BY competition_id', result.data.users[0].id)).map(row => row.competition_id), [firstCard, secondCard]);
});

test('invalid access on any batch member rejects the whole request before any account is written', async () => {
    const invalidAccess = [
        { permissions: [999999] },
        { permissions: ['invalid'] },
        { permissions: 'all' },
        { permissions: [firstCard], timeRules: [] },
        { permissions: [firstCard], timeRules: { [firstCard]: { unlockTime: 'not-a-date' } } },
        { permissions: [firstCard], timeRules: { [firstCard]: { unlockTime: WINDOW.lockTime, lockTime: WINDOW.unlockTime } } }
    ];
    for (const [index, access] of invalidAccess.entries()) {
        const names = [`invalid-batch-first-${index}`, `invalid-batch-second-${index}`];
        const result = await harness.api('/api/users/batch', { body: { users: [
            teacher(names[0], { permissions: [firstCard] }), teacher(names[1], access)
        ] } });
        assert.equal(result.status, 400, result.text);
        assert.equal((await harness.rows('SELECT id FROM users WHERE username IN (?, ?)', ...names)).length, 0);
    }
});

test('a later database write failure rolls back earlier accounts, classes and access rows in the same batch', async () => {
    await harness.run(`CREATE TRIGGER reject_recovery_batch_user BEFORE INSERT ON users
        WHEN NEW.username = 'atomic-second-teacher' BEGIN SELECT RAISE(ABORT, 'batch test rollback'); END`);
    try {
        const result = await harness.api('/api/users/batch', { body: { users: [
            teacher('atomic-first-teacher', { permissions: [firstCard], timeRules: { [firstCard]: WINDOW } }),
            teacher('atomic-second-teacher', { permissions: [] })
        ] } });
        assert.equal(result.status, 500);
        assert.equal((await harness.rows("SELECT id FROM users WHERE username IN ('atomic-first-teacher', 'atomic-second-teacher')")).length, 0);
        assert.equal((await harness.rows("SELECT id FROM classes WHERE name IN ('atomic-first-teacher', 'atomic-second-teacher')")).length, 0);
    } finally { await harness.run('DROP TRIGGER reject_recovery_batch_user'); }
});

test('batch access cannot bypass role hierarchy, teacher card scope or teacher time boundaries', async () => {
    // New accounts must replace their initial password before acting; this
    // case is about an established teacher who has already done so.
    await harness.run('UPDATE users SET password_change_recommended = 0 WHERE id = ?', selectedTeacher.id);
    const teacherToken = await harness.issueToken({ id: selectedTeacher.id, username: selectedTeacher.username, role: 'teacher' });
    const headers = { Authorization: `Bearer ${teacherToken}` };
    const student = (username, access = {}) => ({ username, email: `${username}@example.invalid`, password: 'Initial-password-1', role: 'student', ...access });
    const validWindow = { unlockTime: '2027-01-05T00:00:00.000Z', lockTime: '2027-01-25T00:00:00.000Z' };
    const created = await harness.api('/api/users/batch', { headers, body: { users: [student('within-teacher-scope', { permissions: [firstCard], timeRules: { [firstCard]: validWindow } })] } });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.data.users[0].classId, selectedTeacher.classId);
    assert.deepEqual(await harness.rows('SELECT unlock_time, lock_time FROM user_competition_time_rules WHERE user_id = ?', created.data.users[0].id), [{ unlock_time: validWindow.unlockTime, lock_time: validWindow.lockTime }]);

    const cases = [
        [student('outside-card-scope', { permissions: [secondCard] })],
        [student('outside-time-scope', { permissions: [firstCard], timeRules: { [firstCard]: { unlockTime: '2026-12-01T00:00:00.000Z', lockTime: WINDOW.lockTime } } })],
        [student('missing-parent-time', { permissions: [firstCard], timeRules: {} })],
        [student('valid-first-before-role', { permissions: [] }), teacher('forbidden-same-level-role', { permissions: [] })]
    ];
    for (const users of cases) {
        const result = await harness.api('/api/users/batch', { headers, body: { users } });
        assert.equal(result.status, 403, result.text);
        for (const user of users) assert.equal((await harness.rows('SELECT id FROM users WHERE username = ?', user.username)).length, 0);
    }
    const adminFields = await harness.api('/api/users/batch', { body: { users: [teacher('admin-with-whitelist', { role: 'admin', permissions: [] })] } });
    assert.equal(adminFields.status, 400);
    assert.equal((await harness.rows("SELECT id FROM users WHERE username = 'admin-with-whitelist'")).length, 0);

    await harness.run('UPDATE users SET password_change_recommended = 0 WHERE id = ?', created.data.users[0].id);
    const studentToken = await harness.issueToken({ id: created.data.users[0].id, username: 'within-teacher-scope', role: 'student' });
    const denied = await harness.api('/api/users/batch', { headers: { Authorization: `Bearer ${studentToken}` }, body: { users: [student('student-cannot-create')] } });
    assert.equal(denied.status, 403);
});
