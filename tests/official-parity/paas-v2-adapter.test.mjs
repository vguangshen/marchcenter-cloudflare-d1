import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { createPaasV2Adapter, encryptRsaChunks } from '../../server/utils/officialCompat/paasV2/paasV2Adapter.js';

function pemLines(key) {
    return key.replace(/\r/g, '').replace(/\n$/, '');
}

function decryptRsaChunks(ciphertext, privateKey) {
    const source = Buffer.from(ciphertext, 'base64');
    const chunks = [];
    for (let offset = 0; offset < source.length; offset += 128) {
        chunks.push(crypto.privateDecrypt({
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_PADDING
        }, source.subarray(offset, offset + 128)));
    }
    return Buffer.concat(chunks).toString('utf8');
}

test('paasV2 adapter builds GetTokenInfo request and encrypted POST form', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 1024,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    let received;
    const fetchImplementation = async (url, init) => {
        received = { url, init };
        const body = JSON.parse(init.body);
        const inner = JSON.parse(body.data);
        const tokenInfo = JSON.parse(decryptRsaChunks(inner.ticket, privateKey));
        assert.equal(tokenInfo.userType, '2');
        return new Response(JSON.stringify({ code: '10000', data: 'platform-token-123' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    const config = {
        apiBaseUrl: 'https://dayu.itmc.org.cn/prod-api/agent/open',
        jumpBaseUrl: 'https://dayu.itmc.org.cn/prod-api/agent/open/enterIndex',
        externalPublicKey: publicKey,
        publicKey,
        productId: 'PT04',
        productModuleId: 'scyxcjrh',
        softwareUnique: 'scyxcjrh',
        registerUserId: 'fwq'
    };
    const adapter = createPaasV2Adapter({ config, fetchImplementation });
    const form = await adapter.buildJumpForm({
        loginName: 'mcsalice1',
        teacherUserName: 'mcteacher',
        className: 'mcclass',
        userName: 'Alice',
        currentLoginName: 'alice',
        loginRole: 'student',
        userId: 1,
        plugFlag: '1943850439576195074',
        answerType: '1',
        softwareUnique: 'scyxcjrh'
    });

    assert.equal(form.action, config.jumpBaseUrl);
    assert.equal(form.method, 'POST');
    assert.equal(form.fields.platformToken, 'platform-token-123');
    const jumpData = JSON.parse(decryptRsaChunks(form.fields.data, privateKey));
    assert.equal(jumpData.taskId, '1943850439576195074');
    assert.equal(jumpData.productModuleID, 'scyxcjrh');
    assert.ok(received.url.endsWith('/GetTokenInfo'));
});

test('paasV2 encryptRsaChunks wraps raw base64 public keys into PEM', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 1024,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const raw = pemLines(publicKey).replace('-----BEGIN PUBLIC KEY-----', '').replace('-----END PUBLIC KEY-----', '').replace(/\s/g, '');
    assert.ok(encryptRsaChunks('hello', raw).length > 0);
});
