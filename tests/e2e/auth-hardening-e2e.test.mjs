import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

async function request(harness, pathname, { token, method, body } = {}) {
    const response = await harness.miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, {
        method: method || (body === undefined ? 'GET' : 'POST'),
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* text response */ }
    return { response, status: response.status, data, text };
}

test('bootstrap secret and default reset password require a password change before any other access', async () => {
    const harness = await createProductionHarness({ bootstrapSecret: 'bootstrap-e2e-secret' });
    try {
        await harness.database.prepare('DELETE FROM users').run();

        const setup = await request(harness, '/api/auth/setup-status');
        assert.equal(setup.status, 200);
        assert.equal(setup.data.initialized, false);
        assert.equal(setup.data.bootstrapSecretConfigured, true);

        const registration = {
            username: 'first-admin',
            email: 'first-admin@example.invalid',
            password: 'First-admin-password-1'
        };
        const denied = await request(harness, '/api/auth/register', {
            body: { ...registration, bootstrapSecret: 'wrong-secret' }
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.data.code, 'bootstrap_authorization_required');

        const initialized = await request(harness, '/api/auth/register', {
            body: { ...registration, bootstrapSecret: 'bootstrap-e2e-secret' }
        });
        assert.equal(initialized.status, 201);
        assert.equal(initialized.data.role, 'super_admin');

        const adminLogin = await request(harness, '/api/auth/login', {
            body: { username: registration.username, password: registration.password }
        });
        assert.equal(adminLogin.status, 200);
        const adminToken = adminLogin.data.token;
        assert.ok(adminToken);

        const created = await request(harness, '/api/users', {
            token: adminToken,
            body: {
                username: 'temporary-user',
                email: 'temporary-user@example.invalid',
                password: 'Original-password-1',
                role: 'teacher'
            }
        });
        assert.equal(created.status, 200);

        const oldLogin = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: 'Original-password-1' }
        });
        assert.equal(oldLogin.status, 200);

        const reset = await request(harness, `/api/users/${created.data.id}/reset-password`, {
            token: adminToken,
            method: 'PATCH',
            body: {}
        });
        assert.equal(reset.status, 200);
        assert.equal(reset.response.headers.get('cache-control'), 'no-store');
        assert.equal(reset.data.passwordChangeRecommended, true);
        assert.equal(reset.data.resetPassword, '123456');
        assert.equal(reset.data.revokeMode, 'immediate');
        assert.equal('temporaryPassword' in reset.data, false);
        assert.equal('expiresAt' in reset.data, false);

        const revoked = await request(harness, '/api/auth/me', { token: oldLogin.data.token });
        assert.equal(revoked.status, 401);

        const resetPasswordLogin = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(resetPasswordLogin.status, 200);
        assert.equal(resetPasswordLogin.data.user.passwordChangeRecommended, true);

        for (const [pathname, method] of [['/api/competitions', 'GET'], ['/api/users/me/theme', 'GET'], ['/api/content/updates', 'GET']]) {
            const blocked = await request(harness, pathname, { token: resetPasswordLogin.data.token, method });
            assert.equal(blocked.status, 403, pathname);
            assert.equal(blocked.data.code, 'password_change_required');
        }
        const keepsDefault = await request(harness, '/api/auth/change-password', {
            token: resetPasswordLogin.data.token, body: { password: '123456' }
        });
        assert.equal(keepsDefault.status, 400);

        const identityStillAvailable = await request(harness, '/api/auth/me', { token: resetPasswordLogin.data.token });
        assert.equal(identityStillAvailable.status, 200);
        assert.equal(identityStillAvailable.data.user.passwordChangeRecommended, true);

        const nextLoginStillReminds = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(nextLoginStillReminds.status, 200);
        assert.equal(nextLoginStillReminds.data.user.passwordChangeRecommended, true);

        const otherDevice = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(otherDevice.status, 200);
        const changed = await request(harness, '/api/auth/change-password', {
            token: resetPasswordLogin.data.token,
            body: { password: 'Permanent-password-2' }
        });
        assert.equal(changed.status, 200);
        assert.ok(changed.data.token, 'the changing tab receives a replacement token');
        for (const staleToken of [resetPasswordLogin.data.token, otherDevice.data.token]) {
            const stale = await request(harness, '/api/auth/me', { token: staleToken });
            assert.equal(stale.status, 401, 'a password change signs out every earlier session');
        }
        const rotated = await request(harness, '/api/auth/me', { token: changed.data.token });
        assert.equal(rotated.status, 200);
        assert.equal(rotated.data.user.passwordChangeRecommended, false);
        assert.equal((await request(harness, '/api/competitions', { token: changed.data.token })).status, 200,
            'the account is unlocked once the password is changed');

        const resetPasswordRejected = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(resetPasswordRejected.status, 400);

        const permanentLogin = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: 'Permanent-password-2' }
        });
        assert.equal(permanentLogin.status, 200);
        assert.equal(permanentLogin.data.user.passwordChangeRecommended, false);

        const signedOut = await request(harness, '/api/auth/logout', { token: permanentLogin.data.token, body: {} });
        assert.equal(signedOut.status, 200);
        const afterLogout = await request(harness, '/api/auth/me', { token: permanentLogin.data.token });
        assert.equal(afterLogout.status, 401, 'logout revokes the token on the server');
        const stillSignedIn = await request(harness, '/api/auth/me', { token: changed.data.token });
        assert.equal(stillSignedIn.status, 200, 'logout only ends the current session');

        await request(harness, `/api/users/${created.data.id}/status`, {
            token: adminToken, method: 'PATCH', body: { is_disabled: true }
        });
        const wrongPasswordDisabled = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: 'not-the-password' }
        });
        assert.equal(wrongPasswordDisabled.status, 400, 'disabled state is not revealed without the password');
        const rightPasswordDisabled = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: 'Permanent-password-2' }
        });
        assert.equal(rightPasswordDisabled.status, 403);
    } finally {
        await harness.dispose();
    }
});

test('the saved reset session policy decides when earlier sessions end', async () => {
    const harness = await createProductionHarness();
    try {
        await harness.seedUser({ id: 40, username: 'policy-teacher', role: 'teacher' });
        const before = await harness.issueToken({ id: 40, username: 'policy-teacher', role: 'teacher' });
        const policy = await harness.api('/api/users/me/reset-session-policy', { method: 'PATCH', body: { revokeMode: '1d' } });
        assert.equal(policy.status, 200, policy.text);
        const reset = await harness.api('/api/users/40/reset-password', { method: 'PATCH', body: {} });
        assert.equal(reset.status, 200, reset.text);
        assert.equal(reset.data.revokeMode, '1d');
        assert.ok(Date.parse(reset.data.revokeAt) > Date.now() + 23 * 60 * 60 * 1000);
        assert.equal((await request(harness, '/api/auth/me', { token: before })).status, 200, 'old session survives the grace period');

        await harness.api('/api/users/me/reset-session-policy', { method: 'PATCH', body: { revokeMode: 'immediate' } });
        const immediate = await harness.api('/api/users/40/reset-password', { method: 'PATCH', body: {} });
        assert.equal(immediate.data.revokeMode, 'immediate');
        assert.equal((await request(harness, '/api/auth/me', { token: before })).status, 401);
    } finally {
        await harness.dispose();
    }
});

test('a Worker deployed before the revoked-session migration keeps sessions working', async () => {
    const harness = await createProductionHarness();
    try {
        await harness.run('DROP TABLE revoked_sessions');
        assert.equal((await harness.api('/api/auth/me')).status, 200);
        assert.equal((await harness.api('/api/ready')).status, 503, 'readiness reports the missing migration');
        assert.equal((await harness.api('/api/auth/logout', { body: {} })).status, 503);
    } finally {
        await harness.dispose();
    }
});
