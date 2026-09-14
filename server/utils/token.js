const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(value) {
    const bytes = value instanceof Uint8Array ? value : encoder.encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, value) {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function signToken(payload, secret, expiresInSeconds = 7 * 24 * 60 * 60) {
    const now = Math.floor(Date.now() / 1000);
    const issuedAtMs = Date.now();
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64UrlEncode(JSON.stringify({ ...payload, iat: now, issuedAtMs, exp: now + expiresInSeconds }));
    const signingInput = `${header}.${body}`;
    const signature = base64UrlEncode(await hmac(secret, signingInput));
    return `${signingInput}.${signature}`;
}

export async function verifyToken(token, secret) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Token 格式无效');
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expected = await hmac(secret, signingInput);
    const actual = base64UrlDecode(parts[2]);
    if (expected.length !== actual.length) throw new Error('Token 签名无效');
    let difference = 0;
    for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ actual[i];
    if (difference !== 0) throw new Error('Token 签名无效');
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) throw new Error('Token 已过期');
    return payload;
}
