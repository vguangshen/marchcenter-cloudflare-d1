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

test('bootstrap secret and fixed reset password keep access available while recommending a password change', async () => {
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
        assert.equal('temporaryPassword' in reset.data, false);
        assert.equal('expiresAt' in reset.data, false);

        const revoked = await request(harness, '/api/auth/me', { token: oldLogin.data.token });
        assert.equal(revoked.status, 401);

        const resetPasswordLogin = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(resetPasswordLogin.status, 200);
        assert.equal(resetPasswordLogin.data.user.passwordChangeRecommended, true);

        const normalAccess = await request(harness, '/api/competitions', { token: resetPasswordLogin.data.token });
        assert.equal(normalAccess.status, 200);

        const identityStillAvailable = await request(harness, '/api/auth/me', { token: resetPasswordLogin.data.token });
        assert.equal(identityStillAvailable.status, 200);
        assert.equal(identityStillAvailable.data.user.passwordChangeRecommended, true);

        const nextLoginStillReminds = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(nextLoginStillReminds.status, 200);
        assert.equal(nextLoginStillReminds.data.user.passwordChangeRecommended, true);

        const changed = await request(harness, '/api/auth/change-password', {
            token: resetPasswordLogin.data.token,
            body: { password: 'Permanent-password-2' }
        });
        assert.equal(changed.status, 200);

        const resetPasswordRejected = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: reset.data.resetPassword }
        });
        assert.equal(resetPasswordRejected.status, 400);

        const permanentLogin = await request(harness, '/api/auth/login', {
            body: { username: 'temporary-user', password: 'Permanent-password-2' }
        });
        assert.equal(permanentLogin.status, 200);
        assert.equal(permanentLogin.data.user.passwordChangeRecommended, false);
    } finally {
        await harness.dispose();
    }
});
