import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('only the super administrator receives card-editing configuration', async () => {
    const harness = await createProductionHarness();
    try {
        const cardId = await harness.seedCompetition({ configId: null, method: 'direct', url: 'https://example.invalid' });
        await harness.run(`UPDATE competitions SET account_db_name = 'vendor_db', account_table_name = 'accounts',
            account_password_algorithm = 'plain', custom_prompt = 'internal prompt',
            class_delete_mapping = '{broken json' WHERE id = ?`, cardId);
        await harness.seedUser({ id: 30, username: 'visibility-teacher', role: 'teacher' });
        await harness.run('INSERT INTO user_access_policies (user_id, configured) VALUES (30, 1)');
        await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (30, ?)', cardId);

        const admin = await harness.api('/api/competitions');
        assert.equal(admin.status, 200, admin.text);
        const adminCard = admin.data.find(card => card.id === cardId);
        assert.equal(adminCard.accountDbName, 'vendor_db');
        assert.equal(adminCard.classDeleteMapping, null, 'a damaged mapping no longer breaks the list');

        const token = await harness.issueToken({ id: 30, username: 'visibility-teacher', role: 'teacher' });
        const teacher = await harness.api('/api/competitions', { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(teacher.status, 200, teacher.text);
        const teacherCard = teacher.data.find(card => card.id === cardId);
        assert.ok(teacherCard);
        for (const field of ['accountDbName', 'accountTableName', 'accountPasswordAlgorithm', 'customPrompt', 'classDeleteMapping']) {
            assert.equal(field in teacherCard, false, field);
        }
        assert.equal(teacherCard.url, 'https://example.invalid');
    } finally {
        await harness.dispose();
    }
});
