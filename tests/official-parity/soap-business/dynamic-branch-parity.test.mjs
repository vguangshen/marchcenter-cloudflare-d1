import assert from 'node:assert/strict';
import test from 'node:test';
import { OfficialAdapterParameterError, OfficialResponseParseError } from '../../../server/utils/officialCompat/errors.js';
import {
    addStudentParameters,
    baseStudentValues,
    baseTeacherValues,
    CAPTURED_EVIDENCE,
    createHarness,
    officialResult
} from './helpers.mjs';

function capturedStep(operationName, result, expectedParameters) {
    return { operationName, result, expectedParameters, evidenceLevel: CAPTURED_EVIDENCE };
}

test('group existence code failure with null data still creates group and continues', async () => {
    const values = baseStudentValues();
    const harness = createHarness('net', [
        capturedStep('IsGroupExisted', officialResult(null, {
            code: 10010, succ: false, message: 'group check failed'
        }), { groupName: values.className, groupID: '' }),
        capturedStep('AddTrainGroup', officialResult('group-1'), { groupName: values.className }),
        capturedStep('IsStuExisted', officialResult([values.loginName]), { accountList: [values.loginName] })
    ]);
    assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
    assert.deepEqual(harness.calls.map(call => call.operationName), [
        'IsGroupExisted', 'AddTrainGroup', 'IsStuExisted'
    ]);
    harness.assertComplete();
});

for (const accounts of [['other'], []]) {
    test(`AddStudent successful ${JSON.stringify(accounts)} still allows ticket`, async () => {
        const values = baseStudentValues();
        const student = [{
            studentID: values.loginName,
            password: `train_123${values.userId}`,
            nickName: values.userName
        }];
        const harness = createHarness('net', [
            capturedStep('IsGroupExisted', officialResult('group-1'), {
                groupName: values.className, groupID: ''
            }),
            capturedStep('IsStuExisted', officialResult([]), { accountList: [values.loginName] }),
            capturedStep('AddStudent', officialResult(accounts), addStudentParameters('net', values, student))
        ]);
        assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
        harness.assertComplete();
    });
}

test('non-string existence array is coerced and does not become parse failure or empty array', async () => {
    const values = baseStudentValues();
    const student = [{
        studentID: values.loginName,
        password: `train_123${values.userId}`,
        nickName: values.userName
    }];
    const harness = createHarness('net', [
        capturedStep('IsGroupExisted', officialResult('group-1'), {
            groupName: values.className, groupID: ''
        }),
        capturedStep('IsStuExisted', officialResult([1, { x: 2 }]), { accountList: [values.loginName] }),
        capturedStep('AddStudent', officialResult([values.loginName]), addStudentParameters('net', values, student))
    ]);
    assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
    harness.assertComplete();
});

for (const [label, groupData, groupID] of [
    ['empty', '', ''],
    ['object', { id: 'group-object' }, '{"id":"group-object"}']
]) {
    test(`captured ${label} group creation data continues with exact groupID`, async () => {
        const values = baseStudentValues();
        const student = [{
            studentID: values.loginName,
            password: `train_123${values.userId}`,
            nickName: values.userName
        }];
        const harness = createHarness('net', [
            capturedStep('IsGroupExisted', officialResult(null), {
                groupName: values.className, groupID: ''
            }),
            capturedStep('AddTrainGroup', officialResult(groupData), { groupName: values.className }),
            capturedStep('IsStuExisted', officialResult([]), { accountList: [values.loginName] }),
            capturedStep('AddStudent', officialResult([values.loginName]),
                addStudentParameters('net', values, student, groupID))
        ]);
        assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
        harness.assertComplete();
    });
}

test('marketing null maxRunYear reaches AddStudent parameter conversion and then throws', async () => {
    const values = baseStudentValues({ maxRunYear: null });
    const harness = createHarness('marketing', [
        capturedStep('IsGroupExisted', officialResult('group-1'), {
            groupName: values.className, groupID: ''
        }),
        capturedStep('IsStuExisted', officialResult([]), { accountList: [values.loginName] })
    ]);
    await assert.rejects(harness.adapter.commonCheckTrain(values), OfficialAdapterParameterError);
    assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsStuExisted']);
    harness.assertComplete();
});

for (const platform of ['marketing', 'commerce']) {
    test(`${platform} string maxRunYear fails before SOAP`, async () => {
        const harness = createHarness(platform, []);
        await assert.rejects(
            harness.adapter.commonCheckTrain(baseStudentValues({ maxRunYear: '0' })),
            OfficialAdapterParameterError
        );
        assert.equal(harness.calls.length, 0);
    });
}

test('Java long maximum remains exact in high-level parameters and unsafe Number is rejected', async () => {
    const maximum = '9223372036854775807';
    const values = baseStudentValues({ userId: maximum, startTime: maximum, endTime: maximum });
    const student = [{
        studentID: values.loginName,
        password: `train_123${maximum}`,
        nickName: values.userName
    }];
    const harness = createHarness('net', [
        capturedStep('IsGroupExisted', officialResult('group-1'), {
            groupName: values.className, groupID: ''
        }),
        capturedStep('IsStuExisted', officialResult([]), { accountList: [values.loginName] }),
        capturedStep('AddStudent', officialResult([values.loginName]), {
            ...addStudentParameters('net', values, student),
            st: maximum,
            ed: maximum
        })
    ]);
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    harness.assertComplete();

    const unsafe = createHarness('net', [
        capturedStep('IsGroupExisted', officialResult('group-1'), {
            groupName: values.className, groupID: ''
        }),
        capturedStep('IsStuExisted', officialResult([]), { accountList: [values.loginName] })
    ]);
    await assert.rejects(
        unsafe.adapter.commonCheckTrain(baseStudentValues({ userId: 9223372036854776000 })),
        OfficialAdapterParameterError
    );
    unsafe.assertComplete();
});

test('null and missing AddStudent data throw and never issue a ticket', async () => {
    for (const result of [officialResult(null), { code: 10000, succ: true, message: '成功' }]) {
        const values = baseTeacherValues({ studentList: ['a'] });
        const student = [{ studentID: 'a', password: 'train_123', nickName: 'a' }];
        const harness = createHarness('net', [
            capturedStep('IsGroupExisted', officialResult('group-1'), {
                groupName: values.className, groupID: ''
            }),
            capturedStep('IsTeacherExisted', officialResult([values.loginName]), {
                accountList: [values.loginName]
            }),
            capturedStep('IsStuExisted', officialResult([]), { accountList: ['a'] }),
            capturedStep('AddStudent', result, addStudentParameters('net', values, student))
        ]);
        await assert.rejects(harness.adapter.commonReturnTeacherBaseInfo(values), OfficialResponseParseError);
        assert.equal(harness.tickets.length, 0);
        harness.assertComplete();
    }
});
