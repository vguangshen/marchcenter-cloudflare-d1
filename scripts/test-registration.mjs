import assert from 'node:assert/strict';
import {
    normalizeRegistrationInput,
    registrationCodeSubject,
    registrationValidationError
} from '../server/utils/registration.js';

const normalized = normalizeRegistrationInput({
    username: '  Teacher01 ',
    email: '  USER@Example.COM ',
    password: 'password-123',
    code: '123456'
});

assert.deepEqual(normalized, {
    username: 'Teacher01',
    email: 'user@example.com',
    password: 'password-123',
    code: '123456'
});
assert.equal(registrationValidationError(normalized), '');
assert.equal(
    registrationValidationError({ ...normalized, email: 'example.com' }),
    '请输入有效的电子邮箱'
);
assert.equal(
    registrationValidationError({ ...normalized, code: '' }),
    '请输入有效的 6 位邮箱验证码'
);
assert.equal(
    registrationCodeSubject('Teacher01', 'user@example.com'),
    'user@example.com\nteacher01'
);

console.log('Registration tests passed.');
