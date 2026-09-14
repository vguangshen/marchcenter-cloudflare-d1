import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

test('user list reports recent activity from last_seen_at instead of login time only', async () => {
    const harness = await createProductionHarness();
    try {
        await harness.run(
            `UPDATE users
             SET last_login_at = datetime('now', '-2 hours'),
                 last_seen_at = CURRENT_TIMESTAMP
             WHERE id = 1`
        );

        const result = await harness.api('/api/users?page=1&pageSize=50');
        assert.equal(result.status, 200);
        const admin = result.data.users.find(user => Number(user.id) === 1);
        assert.ok(admin);
        assert.ok(Date.now() - new Date(admin.last_active_time).getTime() < 5 * 60 * 1000);
        assert.ok(Date.now() - new Date(admin.last_login_time).getTime() > 60 * 60 * 1000);
    } finally {
        await harness.dispose();
    }
});
