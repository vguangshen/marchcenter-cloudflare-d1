import CryptoJS from 'crypto-js';
import { validateConfirmedOfficialBaseUrl } from '../officialJumpConfig.js';

// The vendor login page publishes this compatibility key in Common.js.
// It is a protocol constant rather than an application secret.
const NET_LOGIN_DES_KEY = CryptoJS.enc.Utf8.parse('12345678itmcitmc87654321');

export function encryptNetLoginField(value) {
    return CryptoJS.TripleDES.encrypt(String(value ?? ''), NET_LOGIN_DES_KEY, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
    }).toString();
}

export function buildNetAdminLoginPreparation(baseUrl, credential = {}) {
    const officialBaseUrl = validateConfirmedOfficialBaseUrl(baseUrl);
    const username = String(credential.username || '').trim();
    const password = String(credential.password || '');
    if (!username || !password) {
        const error = new Error('该竞赛卡片的 Root 账户或密码未完整配置');
        error.status = 409;
        throw error;
    }

    return Object.freeze({
        // The legacy handler accepts the logout marker together with the
        // encrypted login fields. This replaces an existing teacher/student
        // session and authenticates Root in one target request.
        actionUrl: `${officialBaseUrl}/Login.aspx?op=Login&s=out`,
        redirectUrl: `${officialBaseUrl}/Main/TeacherMain.aspx?GroupType=1`,
        fields: Object.freeze({
            UserName: encryptNetLoginField(username),
            Password: encryptNetLoginField(password),
            VerifyCode: encryptNetLoginField(''),
            LoginIP: '',
            LoginCity: ''
        })
    });
}
