import { validateConfirmedOfficialBaseUrl } from '../officialJumpConfig.js';

export function buildJavaAdminLoginPreparation(baseUrl, credential = {}) {
    const officialBaseUrl = validateConfirmedOfficialBaseUrl(baseUrl);
    const username = String(credential.username || '').trim();
    const password = String(credential.password || '');
    if (!username || !password) {
        const error = new Error('该竞赛卡片的 Admin 账户或密码未完整配置');
        error.status = 409;
        throw error;
    }

    return Object.freeze({
        // PT0404-style Java platforms accept the same parameters for GET as
        // their native login form uses for POST. Keeping the whole exchange in
        // one target request replaces any existing target session and avoids
        // the browser's HTTPS-to-HTTP form warning.
        actionUrl: `${officialBaseUrl}/checkLogin`,
        redirectUrl: `${officialBaseUrl}/pages/admin/admin_index.html`,
        fields: Object.freeze({ username, password })
    });
}
