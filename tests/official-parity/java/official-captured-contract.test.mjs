import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./fixtures/official-java-captures.json', import.meta.url), 'utf8'));
const scenario = name => fixture.scenarios.find(item => item.name === name);
const call = (name, path) => scenario(name).calls.find(item => item.path === path);

test('official-captured student forms lock parameter names and HashMap wire order', () => {
    assert.equal(call('student-train-full-parameters', '/open/getUserName').rawBody,
        'teamName=team%3D1&classMode=2&u=student+local&roleName=%E8%A7%92%E8%89%B2%2F%E4%B8%80&className=%E7%8F%AD%E7%BA%A7+%26+A&teacherUserName=teacher%2Bone');
    assert.equal(call('student-train-full-parameters', '/open/trainingExamPaper').rawBody,
        'st=1&flag=train+flag&u=student+local&ed=2');
    assert.equal(call('student-exam-full-parameters', '/open/trainingExamPaperV2').rawBody,
        'st=1&flag=train+flag&u=student+local&ed=2');
});

test('official-captured null, empty and long values are byte-distinct', () => {
    assert.match(call('student-null-flag', '/open/trainingExamPaper').rawBody, /&flag&/);
    assert.match(call('student-empty-flag', '/open/trainingExamPaper').rawBody, /&flag=&/);
    assert.equal(call('student-long-max-times', '/open/trainingExamPaper').rawBody,
        'st=9223372036854775807&flag=train+flag&u=student+local&ed=9223372036854775807');
});

test('official-captured teacher classMode bug and duplicate traversal are locked', () => {
    const bug = scenario('teacher-multiple-students-classmode-bug').calls.filter(item => item.path === '/open/getUserName');
    assert.equal(bug.length, 2); assert.ok(bug.every(item => !item.rawBody.includes('classMode')));
    const duplicate = scenario('teacher-duplicate-students').calls.filter(item => item.path === '/open/getUserName');
    assert.deepEqual(duplicate.map(item => new URLSearchParams(item.rawBody).get('u')), ['a', 'a', 'b']);
});

test('official-captured 10011 reruns the entire common method and exhausts at three', () => {
    assert.deepEqual(scenario('student-ticket-10011-then-success').calls.map(item => item.path), [
        '/open/tokenInfo', '/open/getUserName', '/open/trainingExamPaper',
        '/open/tokenInfo', '/open/getUserName', '/open/trainingExamPaper'
    ]);
    assert.equal(scenario('student-ticket-10011-three-times').outcome.kind, 'return');
    assert.equal(scenario('student-ticket-10011-three-times').outcome.valueKind, 'null');
});

test('official-captured token retry and immediate parse failures are locked', () => {
    assert.equal(scenario('token-empty-response-three-attempts').calls.length, 3);
    assert.equal(scenario('token-code-failure-three-attempts').calls.length, 3);
    assert.equal(scenario('token-http-non-200').calls.length, 3);
    for (const name of ['token-data-null', 'token-data-missing', 'token-invalid-json', 'token-missing-code']) {
        assert.equal(scenario(name).calls.length, 1);
        assert.equal(scenario(name).outcome.kind, 'exception');
    }
    assert.equal(scenario('token-data-empty').outcome.kind, 'return');
    assert.equal(scenario('token-data-empty').outcome.value, '');
});
