import assert from 'node:assert/strict';
import test from 'node:test';
import { OfficialAdapterParameterError } from '../../../server/utils/officialCompat/errors.js';
import { mapOfficialJumpParameters } from '../../../server/utils/officialCompat/jumpParamMapper.js';
import { buildCiphertext } from '../../../server/utils/officialCompat/ticketCodec.js';
import {
    PLATFORMS,
    addStudentParameters,
    baseStudentValues,
    createHarness,
    officialResult,
    staticStep
} from './helpers.mjs';

test('all three adapters expose official local target and login-name methods without SOAP calls', async () => {
    for (const platform of PLATFORMS) {
        const harness = createHarness(platform, []);
        assert.equal(await harness.adapter.commonReturnTargetId({ loginName: '用户_中文' }), '用户_中文');
        assert.equal(
            await harness.adapter.commonGetLoginName({ loginName: '用户_中文', epuId: 0 }),
            '用户_中文_0'
        );
        assert.equal(harness.calls.length, 0);
        harness.assertComplete();
    }
});

function studentCreationSteps(platform, values, groupOperation = null) {
    const student = {
        studentID: values.loginName,
        password: `train_123${String(BigInt(values.userId))}`,
        nickName: values.userName
    };
    const steps = [staticStep(
        'IsGroupExisted',
        officialResult(groupOperation ? null : 'group-1'),
        { groupName: values.className, groupID: '' }
    )];
    if (groupOperation) {
        steps.push(staticStep(groupOperation, officialResult('group-1'), { groupName: values.className }));
    }
    steps.push(
        staticStep('IsStuExisted', officialResult('[]'), { accountList: [values.loginName] }),
        staticStep('AddStudent', officialResult([values.loginName]), addStudentParameters(platform, values, [student]))
    );
    return steps;
}

test('net defaults startExam null to true', async () => {
    const values = baseStudentValues({ startExam: null });
    const harness = createHarness('net', studentCreationSteps('net', values));
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    assert.equal(harness.calls.at(-1).parameters.startExam, true);
    harness.assertComplete();
});

test('marketing preserves maxRunYear zero', async () => {
    const values = baseStudentValues({ maxRunYear: 0 });
    const harness = createHarness('marketing', studentCreationSteps('marketing', values));
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    assert.equal(harness.calls.at(-1).parameters.maxRunYear, 0);
    harness.assertComplete();
});

test('commerce preserves maxRunYear zero and autoDeal false', async () => {
    const values = baseStudentValues({ maxRunYear: 0, autoDeal: false });
    const harness = createHarness('commerce', studentCreationSteps('commerce', values));
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    assert.equal(harness.calls.at(-1).parameters.maxRunYear, 0);
    assert.equal(harness.calls.at(-1).parameters.autoDeal, false);
    harness.assertComplete();
});

for (const [classType, operationName] of [[1, 'AddTrainGroup'], [2, 'AddAppraisalGroup'], [3, 'AddMegagameGroup']]) {
    test(`classType ${classType} selects ${operationName}`, async () => {
        const values = baseStudentValues({ classType });
        const harness = createHarness('net', studentCreationSteps('net', values, operationName));
        assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
        assert.equal(harness.calls[1].operationName, operationName);
        harness.assertComplete();
    });
}

test('null classType defaults to AddTrainGroup while captured numeric fallthrough also uses it', async () => {
    const values = baseStudentValues({ classType: null });
    const harness = createHarness('net', studentCreationSteps('net', values, 'AddTrainGroup'));
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    harness.assertComplete();

    for (const classType of [0, 4]) {
        const numeric = baseStudentValues({ classType });
        const numericHarness = createHarness('net', studentCreationSteps('net', numeric, 'AddTrainGroup'));
        assert.equal((await numericHarness.adapter.commonCheckTrain(numeric)).code, 10000);
        numericHarness.assertComplete();
    }

    const invalid = createHarness('net', []);
    await assert.rejects(invalid.adapter.commonCheckTrain(
        baseStudentValues({ classType: '1' })
    ), OfficialAdapterParameterError);
    assert.equal(invalid.calls.length, 0);
});

for (const userId of ['9007199254740993', '9223372036854775807']) {
    test(`numeric string userId ${userId} is preserved through Java-long password semantics`, async () => {
        const values = baseStudentValues({ userId });
        const harness = createHarness('net', studentCreationSteps('net', values));
        assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
        assert.equal(harness.calls.at(-1).parameters.studentList[0].password, `train_123${userId}`);
        harness.assertComplete();
    });
}

test('providing only one time makes both timestamps zero', async () => {
    const values = baseStudentValues({ startTime: '123', endTime: null });
    const harness = createHarness('net', studentCreationSteps('net', values));
    assert.equal((await harness.adapter.commonCheckTrain(values)).code, 10000);
    assert.equal(harness.calls.at(-1).parameters.st, 0);
    assert.equal(harness.calls.at(-1).parameters.ed, 0);
    harness.assertComplete();
});

test('empty time strings remain distinct from null and fail Java-long conversion', async () => {
    const values = baseStudentValues({ startTime: '', endTime: '' });
    const harness = createHarness('net', [
        staticStep('IsGroupExisted', officialResult('group-1'), { groupName: values.className, groupID: '' }),
        staticStep('IsStuExisted', officialResult('[]'), { accountList: [values.loginName] })
    ]);
    await assert.rejects(harness.adapter.commonCheckTrain(values), OfficialAdapterParameterError);
    assert.equal(harness.calls.length, 2);
    harness.assertComplete();
});

test('jump mapper preserves undefined, null, empty string, zero and false', () => {
    const mapped = mapOfficialJumpParameters('commonReturnStudentBaseInfo', {
        loginName: '',
        className: null,
        teacherUserName: undefined,
        startTime: '',
        endTime: null,
        flag: '',
        trainOrExam: 'train',
        userId: 0,
        userName: '中文',
        startExam: false,
        classType: undefined,
        maxRunYear: 0,
        autoDeal: false,
        roleName: null,
        teamName: ''
    });
    assert.equal(mapped.loginName, '');
    assert.equal(mapped.className, null);
    assert.equal(mapped.teacherUserName, undefined);
    assert.equal(mapped.userId, 0);
    assert.equal(mapped.startExam, false);
    assert.equal(mapped.maxRunYear, 0);
    assert.equal(mapped.autoDeal, false);
});

test('student and teacher high-level methods use official ticketCodec output', async () => {
    const studentValues = baseStudentValues();
    const studentHarness = createHarness('net', [
        staticStep('IsGroupExisted', officialResult('group-1'), { groupName: studentValues.className, groupID: '' }),
        staticStep('IsStuExisted', officialResult([studentValues.loginName]), { accountList: [studentValues.loginName] })
    ], { useRealTicket: true });
    const expectedStudent = buildCiphertext({ studentID: studentValues.loginName, password: '', nickName: '' });
    assert.equal(await studentHarness.adapter.commonReturnStudentBaseInfo(studentValues), expectedStudent);
    assert.match(expectedStudent, /^[0-9A-F]+$/);
    studentHarness.assertComplete();

    const teacherValues = {
        ...studentValues,
        loginName: '教师甲',
        studentList: []
    };
    const teacherHarness = createHarness('net', [
        staticStep('IsGroupExisted', officialResult('group-1'), { groupName: teacherValues.className, groupID: '' }),
        staticStep('IsTeacherExisted', officialResult([teacherValues.loginName]), { accountList: [teacherValues.loginName] })
    ], { useRealTicket: true });
    const expectedTeacher = buildCiphertext({ studentID: teacherValues.loginName, password: '', nickName: '' });
    assert.equal(await teacherHarness.adapter.commonReturnTeacherBaseInfo(teacherValues), expectedTeacher);
    assert.match(expectedTeacher, /^[0-9A-F]+$/);
    teacherHarness.assertComplete();
});
