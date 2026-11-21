import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const AVATAR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('profile avatar persists for the current user, rejects unsupported or oversized data, and never changes managed fields', async () => {
    const harness = await createProductionHarness({ adminPassword: 'Existing-password-1' });
    try {
        await harness.seedUser({ id: 2, username: 'profile-other-user', role: 'student' });
        const saved = await harness.api('/api/users/me/profile', {
            method: 'PATCH', body: { avatarDataUrl: AVATAR, username: 'attempted-rename', role: 'student' }
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.user.avatarDataUrl, AVATAR);
        assert.equal(saved.data.user.username, 'e2e-admin');
        assert.equal(saved.data.user.role, 'super_admin');
        assert.equal(saved.response.headers.get('cache-control'), 'no-store');
        assert.equal('password_hash' in saved.data.user, false);
        assert.equal((await harness.rows('SELECT avatar_data_url FROM users WHERE id = ?', 2))[0].avatar_data_url, null);

        const identity = await harness.api('/api/auth/me');
        assert.equal(identity.data.user.avatarDataUrl, AVATAR);
        assert.equal(identity.data.user.email, 'e2e@example.invalid');
        for (const avatarDataUrl of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', `data:image/png;base64,${Buffer.alloc(102401).toString('base64')}`]) {
            const denied = await harness.api('/api/users/me/profile', { method: 'PATCH', body: { avatarDataUrl } });
            assert.equal(denied.status, 400);
            assert.equal((await harness.api('/api/auth/me')).data.user.avatarDataUrl, AVATAR);
        }
        const login = await harness.api('/api/auth/login', { body: { username: 'e2e-admin', password: 'Existing-password-1' } });
        assert.equal(login.status, 200);
        assert.equal(login.data.user.avatarDataUrl, AVATAR);
        const tokenPayload = JSON.parse(Buffer.from(login.data.token.split('.')[1], 'base64url').toString('utf8'));
        assert.equal('avatarDataUrl' in tokenPayload, false);

        const removed = await harness.api('/api/users/me/profile', { method: 'PATCH', body: { avatarDataUrl: null } });
        assert.equal(removed.status, 200);
        assert.equal(removed.data.user.avatarDataUrl, null);
        const noAuth = await harness.miniflare.dispatchFetch('http://marchcenter.local/api/users/me/profile', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarDataUrl: AVATAR })
        });
        assert.equal(noAuth.status, 401);
    } finally { await harness.dispose(); }
});

test('voluntary password changes require the current password and keep the administrator reset workflow available', async () => {
    const harness = await createProductionHarness({ adminPassword: 'Existing-password-1' });
    try {
        const missing = await harness.api('/api/auth/change-password', { body: { password: 'Updated-password-2' } });
        assert.equal(missing.status, 400);
        const wrong = await harness.api('/api/auth/change-password', { body: { currentPassword: 'incorrect', password: 'Updated-password-2' } });
        assert.equal(wrong.status, 400);
        const same = await harness.api('/api/auth/change-password', { body: { currentPassword: 'Existing-password-1', password: 'Existing-password-1' } });
        assert.equal(same.status, 400);
        const changed = await harness.api('/api/auth/change-password', { body: { currentPassword: 'Existing-password-1', password: 'Updated-password-2' } });
        assert.equal(changed.status, 200);
        // The change revokes earlier sessions and hands this tab a fresh token.
        assert.equal((await harness.api('/api/auth/me')).status, 401);
        const as = token => ({ headers: { Authorization: `Bearer ${token}` } });
        assert.equal((await harness.api('/api/auth/me', as(changed.data.token))).status, 200);
        assert.equal((await harness.api('/api/auth/login', { body: { username: 'e2e-admin', password: 'Existing-password-1' } })).status, 400);
        assert.equal((await harness.api('/api/auth/login', { body: { username: 'e2e-admin', password: 'Updated-password-2' } })).status, 200);

        await harness.run('UPDATE users SET password_change_recommended = 1 WHERE id = 1');
        const recommended = await harness.api('/api/auth/change-password', { ...as(changed.data.token), body: { password: 'Permanent-password-3' } });
        assert.equal(recommended.status, 200);
        assert.equal((await harness.api('/api/auth/me', as(recommended.data.token))).data.user.passwordChangeRecommended, false);
        assert.equal((await harness.api('/api/auth/login', { body: { username: 'e2e-admin', password: 'Permanent-password-3' } })).status, 200);
    } finally { await harness.dispose(); }
});
