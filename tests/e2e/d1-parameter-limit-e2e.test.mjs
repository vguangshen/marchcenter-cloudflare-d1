import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

// D1 rejects a single statement with more than 100 bound parameters. These
// routes accept larger administrator selections and must stay below it.
let harness;
let classId;

before(async () => {
    harness = await createProductionHarness();
    await harness.seedUser({ id: 50, username: 'limit-teacher', role: 'teacher' });
    const created = await harness.run("INSERT INTO classes (name, teacher_user_id, created_by) VALUES ('limit-class', 50, 1)");
    classId = Number(created.meta.last_row_id);
});
after(async () => { await harness?.dispose(); });

async function seedCompetitions(first, count) {
    const ids = Array.from({ length: count }, (_, index) => first + index);
    const statements = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
        const group = ids.slice(offset, offset + 50);
        statements.push(harness.database.prepare(
            `INSERT INTO competitions (id, title, url, sso_method) VALUES ${group.map(() => "(?, 'limit card', 'https://example.invalid', 'direct')").join(', ')}`
        ).bind(...group));
    }
    await harness.database.batch(statements);
    return ids;
}

test('batch user creation accepts the advertised 200 accounts', async () => {
    const users = Array.from({ length: 200 }, (_, index) => ({
        username: `limit-student-${String(index).padStart(3, '0')}`,
        password: 'limit-password',
        role: 'student',
        classId,
        permissions: []
    }));
    const result = await harness.api('/api/users/batch', { method: 'POST', body: { users } });
    assert.equal(result.status, 201, result.text);
    assert.equal(result.data.count, 200);
    assert.ok(result.data.users.every(user => Number(user.id) > 0 && user.className === 'limit-class'));

    const duplicate = await harness.api('/api/users/batch', { method: 'POST', body: { users: users.slice(0, 150) } });
    assert.equal(duplicate.status, 409, duplicate.text);
});

test('saving more than 100 competition permissions succeeds', async () => {
    await harness.seedUser({ id: 60, username: 'limit-permission-student', role: 'student' });
    const competitionIds = await seedCompetitions(5000, 150);
    const result = await harness.api('/api/users/60/permissions', {
        method: 'PATCH',
        body: { permissions: competitionIds, timeRules: {} }
    });
    assert.equal(result.status, 200, result.text);
    const [{ count }] = await harness.rows('SELECT COUNT(*) AS count FROM user_permissions WHERE user_id = 60');
    assert.equal(Number(count), 150);

    const missing = await harness.api('/api/users/60/permissions', {
        method: 'PATCH',
        body: { permissions: [...competitionIds, 999999], timeRules: {} }
    });
    assert.equal(missing.status, 400, missing.text);
});

test('gifts can target more than 100 users and the user list can page 200 rows', async () => {
    const [students] = [await harness.rows("SELECT id FROM users WHERE username LIKE 'limit-student-%' ORDER BY id")];
    assert.ok(students.length >= 120);
    const gifts = students.slice(0, 120).map(({ id }) => ({
        id: `limit-gift-${id}`, targetUserId: id, title: 'Limit gift', type: 'text', content: 'hello'
    }));
    const sent = await harness.api('/api/content/gifts', { method: 'POST', body: gifts });
    assert.equal(sent.status, 200, sent.text);
    const [{ count }] = await harness.rows("SELECT COUNT(*) AS count FROM user_gifts WHERE id LIKE 'limit-gift-%'");
    assert.equal(Number(count), 120);

    const listed = await harness.api('/api/users?page=1&pageSize=200');
    assert.equal(listed.status, 200, listed.text);
    assert.equal(listed.data.users.length, 200);
    assert.ok(listed.data.users.every(user => Array.isArray(user.permissions)));
});
