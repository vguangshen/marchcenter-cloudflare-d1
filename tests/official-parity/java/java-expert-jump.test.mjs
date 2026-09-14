import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildExpertPayloadPlaintext,
    buildJavaExpertJumpUrl,
    encryptExpertPayload,
    normalizeExpertName
} from '../../../server/utils/officialCompat/java/expertJump.js';

const BASE = 'http://127.0.0.1:9289/DS50108';
const KNOWN_CIPHERTEXT = 'MBBUeZ/17KZjQArLp4v8VSuclPqpURCulQPuTEUQL7M=';

test('Java evaluator payload matches the recovered AES protocol', () => {
    const plaintext = buildExpertPayloadPlaintext('mcsalice1', 'mcealice');
    assert.equal(plaintext, 'mcsalice1=mcealice');
    assert.equal(encryptExpertPayload(plaintext), KNOWN_CIPHERTEXT);
});

test('Java evaluator jump URL preserves vendor URL encoding', () => {
    assert.equal(
        buildJavaExpertJumpUrl(BASE, 'mcsalice1', 'mcealice'),
        `${BASE}/open/toExpertPage?expertuserdata=${encodeURIComponent(KNOWN_CIPHERTEXT)}`
    );
});

test('Evaluator names reject the delimiter used by the original protocol', () => {
    assert.throws(() => normalizeExpertName('judge=name', 'fallback'), /等号/);
    assert.throws(() => buildExpertPayloadPlaintext('mcsalice1', 'judge=name'), /原版评委入口格式/);
});

