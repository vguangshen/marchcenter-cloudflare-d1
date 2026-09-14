import assert from 'node:assert/strict';
import test from 'node:test';
import { adapterWithPlan, failure, ok, teacherParameters, tokenSuccess } from './helpers.mjs';

test('teacher flow preserves order, duplicates, input and captured classMode bug', async () => {
    const parameters = teacherParameters({ studentList: ['a', 'a', 'b'] });
    const before = structuredClone(parameters);
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('T')], '/open/getLoginTeacherName': [ok('teacher +%&=/中文')],
        '/open/getUserName': [ok('a1'), ok('a2'), ok('b')]
    });
    const output = await subject.adapter.commonReturnTeacherBaseInfo(parameters);
    assert.deepEqual(subject.calls.map(call => call.path), ['/open/tokenInfo', '/open/getLoginTeacherName', '/open/getUserName', '/open/getUserName', '/open/getUserName']);
    assert.deepEqual(parameters, before);
    assert.ok(subject.calls.slice(2).every(call => !call.body.includes('classMode')));
    assert.deepEqual(subject.calls.slice(2).map(call => new URLSearchParams(call.body).get('u')), ['a', 'a', 'b']);
    assert.equal(output.data, 'teacherUserName=teacher+%2B%25%26%3D%2F%E4%B8%AD%E6%96%87&className=班级 & A&classMode=3');
});

test('null and empty studentList skip student calls', async () => {
    for (const studentList of [null, []]) {
        const subject = adapterWithPlan({ '/open/tokenInfo': [tokenSuccess('T')], '/open/getLoginTeacherName': [ok('teacher')] });
        await subject.adapter.commonReturnTeacherBaseInfo(teacherParameters({ studentList }));
        assert.deepEqual(subject.calls.map(call => call.path), ['/open/tokenInfo', '/open/getLoginTeacherName']);
    }
});

test('ready teacher refreshes its ticket without repeating student account sync', async () => {
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('T')],
        '/open/getLoginTeacherName': [ok('teacher')]
    });
    const output = await subject.adapter.commonReturnTeacherBaseInfo(
        teacherParameters({ studentList: ['a', 'b'], accountWasReady: true })
    );
    assert.deepEqual(subject.calls.map(call => call.path), ['/open/tokenInfo', '/open/getLoginTeacherName']);
    assert.equal(output.data, 'teacherUserName=teacher&className=班级 & A&classMode=3');
});

test('student failure stops immediately and returns that Result', async () => {
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('T')], '/open/getLoginTeacherName': [ok('teacher')],
        '/open/getUserName': [ok('a'), failure(10010, 'b failed'), ok('c')]
    });
    const output = await subject.adapter.commonReturnTeacherBaseInfo(teacherParameters({ studentList: ['a', 'b', 'c'] }));
    assert.equal(output.code, 10010); assert.equal(subject.calls.filter(call => call.path.endsWith('getUserName')).length, 2);
});

test('teacher data only URL-encodes teacherUserName; className and classMode stay raw', async () => {
    const subject = adapterWithPlan({ '/open/tokenInfo': [tokenSuccess('T')], '/open/getLoginTeacherName': [ok('a b+c')] });
    const output = await subject.adapter.commonReturnTeacherBaseInfo(teacherParameters({ studentList: [] }));
    assert.equal(output.data, 'teacherUserName=a+b%2Bc&className=班级 & A&classMode=3');
});
