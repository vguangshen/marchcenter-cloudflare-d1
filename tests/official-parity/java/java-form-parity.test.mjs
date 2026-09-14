import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeJavaForm, javaUrlEncode } from '../../../server/utils/officialCompat/java/formCodec.js';
import { orderJavaOperationParameters } from '../../../server/utils/officialCompat/java/operationRegistry.js';

test('Java URL encoding differs correctly from encodeURIComponent', () => {
    assert.equal(javaUrlEncode(' a+b%&=/中文~!*'), '+a%2Bb%25%26%3D%2F%E4%B8%AD%E6%96%87%7E%21*');
});

test('null is bare name, empty is name=, false and zero are preserved', () => {
    assert.equal(encodeJavaForm([['a', null], ['b', ''], ['c', false], ['d', 0]]), 'a&b=&c=false&d=0');
});

test('captured getUserName and ticket form order is exact', () => {
    const user = orderJavaOperationParameters('getUserName', {
        teamName: 'team=1', classMode: '2', u: 'student local', roleName: '角色/一',
        className: '班级 & A', teacherUserName: 'teacher+one'
    });
    assert.equal(encodeJavaForm(user), 'teamName=team%3D1&classMode=2&u=student+local&roleName=%E8%A7%92%E8%89%B2%2F%E4%B8%80&className=%E7%8F%AD%E7%BA%A7+%26+A&teacherUserName=teacher%2Bone');
    assert.equal(encodeJavaForm(orderJavaOperationParameters('trainingExamPaperV2', {
        st: '9223372036854775807', flag: null, u: '学生', ed: '9223372036854775807'
    })), 'st=9223372036854775807&flag&u=%E5%AD%A6%E7%94%9F&ed=9223372036854775807');
});

test('unsafe JavaScript numbers are rejected before long precision can drift', () => {
    assert.throws(() => encodeJavaForm([['st', 9223372036854776000]]), /不安全数字/);
    assert.equal(encodeJavaForm([['st', '9223372036854775807']]), 'st=9223372036854775807');
});
