import assert from 'node:assert/strict';
import test from 'node:test';
import { adapterWithPlan, failure, ok, studentParameters, tokenSuccess } from './helpers.mjs';

test('student train flow is token -> getUserName -> trainingExamPaper with exact data', async () => {
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('TOKEN')], '/open/getUserName': [ok('ready')],
        '/open/trainingExamPaper': [ok('ticket +%&=/中文')]
    });
    const output = await subject.adapter.commonReturnStudentBaseInfo(studentParameters());
    assert.deepEqual(subject.calls.map(call => call.path), ['/open/tokenInfo', '/open/getUserName', '/open/trainingExamPaper']);
    assert.equal(subject.calls[2].body, 'st=1&flag=train+flag&u=student+local&ed=2');
    assert.equal(output.data, 'u=ticket+%2B%25%26%3D%2F%E4%B8%AD%E6%96%87');
});

test('exam selects V2 but submits the same four parameters', async () => {
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('TOKEN')], '/open/getUserName': [ok('ready')],
        '/open/trainingExamPaperV2': [ok('exam-ticket')]
    });
    await subject.adapter.commonReturnStudentBaseInfo(studentParameters({ trainOrExam: 'exam' }));
    assert.equal(subject.calls[2].path, '/open/trainingExamPaperV2');
    assert.equal(subject.calls[2].body, 'st=1&flag=train+flag&u=student+local&ed=2');
});

test('null, empty, zero and maximum long remain distinct on the wire', async () => {
    const subject = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('TOKEN')], '/open/getUserName': [ok('ready')],
        '/open/trainingExamPaper': [ok('ticket')]
    });
    await subject.adapter.commonReturnStudentBaseInfo(studentParameters({
        flag: null, startTime: '9223372036854775807', endTime: '0'
    }));
    assert.equal(subject.calls[2].body, 'st=9223372036854775807&flag&u=student+local&ed=0');
    assert.doesNotMatch(subject.calls[2].body, /9223372036854776000/);
});

test('getUserName 10010 throws; ticket 10010 returns failure without local ticket codec', async () => {
    const userFailure = adapterWithPlan({ '/open/tokenInfo': [tokenSuccess('T')], '/open/getUserName': [failure(10010, 'bad%20user')] });
    await assert.rejects(userFailure.adapter.commonReturnStudentBaseInfo(studentParameters()), /bad user/);
    const ticketFailure = adapterWithPlan({
        '/open/tokenInfo': [tokenSuccess('T')], '/open/getUserName': [ok('ready')],
        '/open/trainingExamPaper': [failure(10010, 'ticket failed')]
    });
    const output = await ticketFailure.adapter.commonReturnStudentBaseInfo(studentParameters());
    assert.equal(output.code, 10010); assert.equal(output.message, 'ticket failed');
});

test('ticket null/missing/invalid results never degrade to success or []', async () => {
    for (const response of [
        { body: JSON.stringify({ code: 10000, succ: true, message: '成功', data: null }) },
        { body: JSON.stringify({ code: 10000, succ: true, message: '成功' }) },
        { body: '{invalid' }
    ]) {
        const subject = adapterWithPlan({
            '/open/tokenInfo': [tokenSuccess('T')], '/open/getUserName': [ok('ready')], '/open/trainingExamPaper': [response]
        });
        await assert.rejects(subject.adapter.commonReturnStudentBaseInfo(studentParameters()));
    }
});
