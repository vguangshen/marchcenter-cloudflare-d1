import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

let harness;
let cardId;

before(async () => {
    harness = await createProductionHarness();
    cardId = await harness.seedCompetition({ configId: null, method: 'direct' });
});
after(async () => { await harness?.dispose(); });

const revision = async () => Number((await harness.rows(
    "SELECT revision FROM content_revisions WHERE content_type = 'gifts'"
))[0].revision);

async function seedStudents(first, count, classId = null) {
    const ids = Array.from({ length: count }, (_, index) => first + index);
    const statements = [];
    const fixtures = [
        ['INSERT INTO users (id, username, email, password_hash, role, class_id) VALUES ', "(?, ?, ?, 'unused', 'student', ?)",
            ids.map(id => [id, `delete-student-${id}`, `delete-${id}@example.invalid`, classId])],
        ['INSERT INTO user_permissions (user_id, competition_id) VALUES ', '(?, ?)', ids.map(id => [id, cardId])],
        ['INSERT INTO user_access_policies (user_id, configured) VALUES ', '(?, 1)', ids.map(id => [id])],
        ['INSERT INTO user_gifts (id, target_user_id, title, sent_at) VALUES ', "(?, ?, 'Delete test gift', CURRENT_TIMESTAMP)",
            ids.map(id => [`delete-gift-${id}`, id])]
    ];
    for (const [prefix, values, rows] of fixtures) {
        const perStatement = Math.floor(100 / rows[0].length);
        for (let offset = 0; offset < rows.length; offset += perStatement) {
            const group = rows.slice(offset, offset + perStatement);
            statements.push(harness.database.prepare(prefix + group.map(() => values).join(', ')).bind(...group.flat()));
        }
    }
    await harness.database.batch(statements);
    return ids;
}

async function rangeCount(table, column, first, last) {
    return Number((await harness.rows(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} BETWEEN ? AND ?`, first, last))[0].count);
}

test('200 students and their dependent rows are deleted together, with one content revision change', async () => {
    const ids = await seedStudents(1000, 200);
    await harness.run("INSERT INTO logo_library (data_url, content_hash, created_by) VALUES ('data:image/png;base64,AA==', 'delete-logo-success', ?)", ids[0]);
    const previousRevision = await revision();
    const result = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: ids } });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.data.count, 200);
    assert.deepEqual(result.data.userIds, ids);
    assert.equal(result.data.giftsRevision, previousRevision + 1);
    for (const [table, column] of [['users', 'id'], ['user_permissions', 'user_id'], ['user_access_policies', 'user_id'], ['user_gifts', 'target_user_id']]) {
        assert.equal(await rangeCount(table, column, ids[0], ids.at(-1)), 0, table);
    }
    assert.deepEqual(await harness.rows("SELECT created_by FROM logo_library WHERE content_hash = 'delete-logo-success'"), [{ created_by: null }]);
    assert.equal(await revision(), previousRevision + 1);

    // Existing API semantics are explicit: a repeat is 404, without mutations.
    const repeated = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: ids } });
    assert.equal(repeated.status, 404);
    assert.equal(await revision(), previousRevision + 1);
});

test('a failure in the second 100-user deletion group rolls back all 200 users and earlier dependent writes', async () => {
    const ids = await seedStudents(2000, 200);
    await harness.run("INSERT INTO logo_library (data_url, content_hash, created_by) VALUES ('data:image/png;base64,AA==', 'delete-logo-rollback', ?)", ids[0]);
    const previousRevision = await revision();
    await harness.run(`CREATE TRIGGER reject_late_user_delete BEFORE DELETE ON users
        WHEN OLD.id = 2199 BEGIN SELECT RAISE(ABORT, 'injected late deletion failure'); END`);
    try {
        const result = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: ids } });
        assert.equal(result.status, 500);
        for (const [table, column] of [['users', 'id'], ['user_permissions', 'user_id'], ['user_access_policies', 'user_id'], ['user_gifts', 'target_user_id']]) {
            assert.equal(await rangeCount(table, column, ids[0], ids.at(-1)), 200, table);
        }
        assert.deepEqual(await harness.rows("SELECT created_by FROM logo_library WHERE content_hash = 'delete-logo-rollback'"), [{ created_by: ids[0] }]);
        assert.equal(await revision(), previousRevision);
    } finally { await harness.run('DROP TRIGGER reject_late_user_delete'); }

    const retry = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: ids } });
    assert.equal(retry.status, 200, retry.text);
    assert.equal(retry.data.count, 200);
    assert.equal(await revision(), previousRevision + 1);
});

test('a missing ID or invalid batch rejects before deleting any existing member', async () => {
    const [id] = await seedStudents(3000, 1);
    const previousRevision = await revision();
    for (const [userIds, expectedStatus] of [[[id, 99999999], 404], [[id, 'invalid'], 400], [Array.from({ length: 201 }, (_, index) => 10000 + index), 400]]) {
        const result = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds } });
        assert.equal(result.status, expectedStatus, result.text);
        assert.equal(await rangeCount('users', 'id', id, id), 1);
        assert.equal(await revision(), previousRevision);
    }
    const deduplicated = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: [id, String(id)] } });
    assert.equal(deduplicated.status, 200);
    assert.equal(deduplicated.data.count, 1);
});

test('content revision failure rolls back both batch and single-user deletion', async () => {
    const ids = await seedStudents(4000, 2);
    const previousRevision = await revision();
    await harness.run(`CREATE TRIGGER reject_delete_revision BEFORE UPDATE ON content_revisions
        WHEN OLD.content_type = 'gifts' BEGIN SELECT RAISE(ABORT, 'injected revision failure'); END`);
    try {
        const batch = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: ids } });
        assert.equal(batch.status, 500);
        const single = await harness.api(`/api/users/${ids[0]}`, { method: 'DELETE' });
        assert.equal(single.status, 500);
        assert.equal(await rangeCount('users', 'id', ids[0], ids.at(-1)), 2);
        assert.equal(await rangeCount('user_gifts', 'target_user_id', ids[0], ids.at(-1)), 2);
        assert.equal(await revision(), previousRevision);
    } finally { await harness.run('DROP TRIGGER reject_delete_revision'); }
    const single = await harness.api(`/api/users/${ids[0]}`, { method: 'DELETE' });
    assert.equal(single.status, 200, single.text);
    assert.equal(single.data.giftsRevision, previousRevision + 1);
});

test('batch deletion retains self, hierarchy, teacher-class and occupied-class restrictions', async () => {
    await harness.seedUser({ id: 5000, username: 'delete-teacher-a', role: 'teacher' });
    await harness.seedUser({ id: 5001, username: 'delete-teacher-b', role: 'teacher' });
    await harness.run("INSERT INTO classes (id, name, teacher_user_id) VALUES (5000, 'Delete class A', 5000), (5001, 'Delete class B', 5001)");
    await harness.run('UPDATE users SET class_id = id WHERE id IN (5000, 5001)');
    const [ownStudent] = await seedStudents(5100, 1, 5000);
    const [otherStudent] = await seedStudents(5101, 1, 5001);
    const teacherToken = await harness.issueToken({ id: 5000, username: 'delete-teacher-a', role: 'teacher' });
    const headers = { Authorization: `Bearer ${teacherToken}` };
    for (const [userIds, expectedStatus] of [[[5000], 400], [[5001], 403], [[ownStudent, otherStudent], 403]]) {
        const result = await harness.api('/api/users/batch', { method: 'DELETE', headers, body: { userIds } });
        assert.equal(result.status, expectedStatus, result.text);
    }
    const occupied = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: [5000, ownStudent] } });
    assert.equal(occupied.status, 409);
    assert.equal(await rangeCount('users', 'id', ownStudent, otherStudent), 2);
    const own = await harness.api('/api/users/batch', { method: 'DELETE', headers, body: { userIds: [ownStudent] } });
    assert.equal(own.status, 200, own.text);
    const teacher = await harness.api('/api/users/batch', { method: 'DELETE', body: { userIds: [5000] } });
    assert.equal(teacher.status, 200, teacher.text);
    assert.deepEqual(await harness.rows('SELECT id FROM classes WHERE id = 5000'), []);
    assert.equal(await rangeCount('users', 'id', otherStudent, otherStudent), 1);
});
