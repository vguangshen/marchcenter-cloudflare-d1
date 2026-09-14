import assert from 'node:assert/strict';
import test from 'node:test';
import { javaUrlDecode, javaUrlEncode } from '../../../server/utils/officialCompat/java/formCodec.js';

test('Java UTF-8 URL encoding golden vectors', () => {
    const vectors = [
        ['a b', 'a+b'], ['a+b', 'a%2Bb'], ['%', '%25'], ['&=', '%26%3D'],
        ['中文/路径', '%E4%B8%AD%E6%96%87%2F%E8%B7%AF%E5%BE%84'], ['~!*', '%7E%21*']
    ];
    for (const [plain, encoded] of vectors) assert.equal(javaUrlEncode(plain), encoded);
});

test('Java URLDecoder treats plus as a space', () => {
    assert.equal(javaUrlDecode('a+b%2Bc'), 'a b+c');
});
