import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('the directory pages teachers once, searches their students and preserves class access', async () => {
    const harness = await createProductionHarness();
    try {
        await harness.run(`INSERT INTO users (id, username, role, password_hash, class_id) VALUES
            (2, 'teacher-a', 'teacher', 'placeholder', 20),
            (3, 'teacher-b', 'teacher', 'placeholder', 30),
            (4, 'new-student', 'student', 'placeholder', 20),
            (5, 'legacy-student', 'user', 'placeholder', 20),
            (6, 'no-class', 'student', 'placeholder', NULL),
            (7, 'no-teacher', 'student', 'placeholder', 40),
            (8, 'peer-super-account', 'super_admin', 'placeholder', NULL)`);
        await harness.run(`INSERT INTO classes (id, name, teacher_user_id) VALUES
            (20, 'A', 2), (30, 'B', 3), (40, 'Lost owner', 999)`);
        await harness.run("UPDATE users SET email = 'find-by-email@test.invalid', last_ip = '203.0.113.27' WHERE id = 5");
        await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (5, 42)');
        await harness.run("INSERT INTO user_competition_time_rules (user_id, competition_id, unlock_time) VALUES (5, 42, '2026-01-01T00:00:00Z')");

        const list = async (query, headers) => {
            const result = await harness.api(`/api/users?${query}`, { headers });
            assert.equal(result.status, 200, result.text);
            return result.data;
        };
        const group = 'view=hierarchy';
        const first = await list(`${group}&pageSize=2`);
        assert.equal(first.total, 7);
        assert.equal(first.totalPages, 3);
        assert.deepEqual(first.users.map(row => row.id), [1, 3]);
        const second = await list(`${group}&pageSize=2&page=2`);
        assert.deepEqual(second.users.map(row => row.id), [2, 7]);
        assert.equal(second.users[0].studentCount, 2);
        assert.deepEqual((await list(`${group}&pageSize=2&page=3`)).users.map(row => row.id), [6]);

        for (const keyword of ['find-by-email', '203.0.113.27', 'LEGACY-STUDENT']) {
            const matched = await list(`${group}&search=${keyword}`);
            assert.equal(matched.total, 1);
            assert.deepEqual(matched.users.map(row => [row.id, row.studentCount, row.matchingStudentCount]), [[2, 2, 1]]);
            const children = await list(`teacherId=2&search=${keyword}`);
            assert.deepEqual(children.users.map(row => [row.id, row.role, row.permissions]), [[5, 'student', [42]]]);
            assert.deepEqual(children.users[0].timeRules['42'], { unlockTime: '2026-01-01T00:00:00Z', lockTime: null });
        }
        assert.equal((await list(`${group}&search=teacher-a`)).users[0].matchingStudentCount, 0);
        const children = await list('teacherId=2&pageSize=1');
        assert.equal(children.totalPages, 2);
        assert.deepEqual(children.users.map(row => row.id), [5]);
        assert.deepEqual((await list('teacherId=2&pageSize=1&page=2')).users.map(row => row.id), [4]);
        assert.deepEqual((await list('view=candidates&search=legacy')).users.map(row => row.id), [5]);

        const teacherToken = await harness.issueToken({ id: 2, username: 'teacher-a', role: 'teacher' });
        const headers = { Authorization: `Bearer ${teacherToken}` };
        const teachersView = await list(group, headers);
        assert.equal(teachersView.total, 3);
        assert.deepEqual(teachersView.users.map(row => [row.id, row.studentCount]), [[2, 2]]);
        assert.equal((await list(`${group}&search=no-class`, headers)).total, 0);
        assert.deepEqual((await list('view=candidates', headers)).users.map(row => row.id), [5, 4]);
        assert.equal((await harness.api('/api/users?teacherId=3', { headers })).status, 403);

        const changed = await harness.api('/api/users/5/class', { method: 'PATCH', body: { classId: 30 } });
        assert.equal(changed.status, 200, changed.text);
        assert.deepEqual((await list(`${group}&search=legacy`)).users.map(row => [row.id, row.studentCount]), [[3, 1]]);
        assert.equal((await list('teacherId=2&search=legacy', headers)).total, 0);
    } finally {
        await harness.dispose();
    }
});
