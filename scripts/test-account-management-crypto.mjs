import assert from 'node:assert/strict';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { createDatabaseConfigEnvelope } from '../server/utils/accountManagementApi.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096 });
const publicJwk = publicKey.export({ format: 'jwk' });

const connections = {
    sqlServer: {
        Enabled: true,
        Host: 'localhost',
        Port: 1433,
        User: 'sa',
        Password: 'sql-secret',
        InitialDatabase: 'master',
        Encrypt: false,
        TrustServerCertificate: true
    },
    mySql: {
        Enabled: true,
        Host: 'localhost',
        Port: 3306,
        User: 'root',
        Password: 'mysql-secret',
        InitialDatabase: 'mysql',
        SslMode: 'None'
    }
};

const envelope = await createDatabaseConfigEnvelope({
    endpointUrl: 'https://account-api.example.com',
    enabled: true,
    deviceId: 'test-device',
    publicKey: publicJwk
}, connections, 123);

const decrypt = value => JSON.parse(privateDecrypt({
    key: privateKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha1'
}, Buffer.from(value, 'base64url')).toString('utf8'));

assert.equal(envelope.algorithm, 'RSA-OAEP-SHA1');
assert.equal(envelope.version, 123);
assert.equal(decrypt(envelope.sqlServer).Password, 'sql-secret');
assert.equal(decrypt(envelope.mySql).Password, 'mysql-secret');

console.log('Account-management database encryption round-trip passed.');
