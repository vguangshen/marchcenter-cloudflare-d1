import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildCiphertext,
    buildStudentBaseClassPlaintext
} from '../../server/utils/officialCompat/ticketCodec.js';

const VERIFIED_PLAINTEXT = '{"studentID":"student-1","password":"","nickName":""}';
const VERIFIED_CIPHERTEXT = '636559C5FDDFC3B2158CE2B4503AC97150496F77BE75A87421E05597869F52958AD2905F675AA9F80A2DE86BE15A3FC2908F541B3B29E7E3';

test('StudentBaseClass uses official field order and empty-string defaults', () => {
    assert.equal(buildStudentBaseClassPlaintext({ studentID: 'student-1' }), VERIFIED_PLAINTEXT);
    assert.equal(
        buildStudentBaseClassPlaintext({ studentID: 'student-1', password: null, nickName: undefined }),
        VERIFIED_PLAINTEXT
    );
});

test('GetRegisterCode fixed ciphertext matches the original JAR byte-for-byte', () => {
    assert.equal(buildCiphertext({ studentID: 'student-1' }, 'itmc'), VERIFIED_CIPHERTEXT);
});

