import assert from 'node:assert/strict';
import test from 'node:test';
import { OfficialResponseParseError } from '../../../server/utils/officialCompat/errors.js';
import {
    PLATFORMS,
    addStudentParameters,
    baseStudentValues,
    baseTeacherValues,
    createHarness,
    negativeStep,
    officialResult,
    staticStep
} from './helpers.mjs';

const groupCheck = values => ({ groupName: values.className, groupID: '' });
const groupCreate = values => ({ groupName: values.className });

for (const platform of PLATFORMS) {
    test(`${platform} student: missing group and account creates both before ticket`, async () => {
        const values = baseStudentValues();
        const student = { studentID: values.loginName, password: 'train_1230', nickName: values.userName };
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult(null), groupCheck(values)),
            staticStep('AddTrainGroup', officialResult('group-1'), groupCreate(values)),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: [values.loginName] }),
            staticStep('AddStudent', officialResult(JSON.stringify([values.loginName])), addStudentParameters(platform, values, [student]))
        ]);
        assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), [
            'IsGroupExisted', 'AddTrainGroup', 'IsStuExisted', 'AddStudent'
        ]);
        assert.equal(harness.tickets.length, 1);
        harness.assertComplete();
    });

    test(`${platform} student: existing group and account never creates duplicates`, async () => {
        const values = baseStudentValues();
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsStuExisted', officialResult([values.loginName]), { accountList: [values.loginName] })
        ]);
        assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsStuExisted']);
        assert.equal(harness.tickets.length, 1);
        harness.assertComplete();
    });

    test(`${platform} student: missing account in existing group creates only student`, async () => {
        const values = baseStudentValues();
        const student = { studentID: values.loginName, password: 'train_1230', nickName: values.userName };
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: [values.loginName] }),
            staticStep('AddStudent', officialResult([values.loginName]), addStudentParameters(platform, values, [student]))
        ]);
        assert.equal(await harness.adapter.commonReturnStudentBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsStuExisted', 'AddStudent']);
        assert.equal(harness.tickets.length, 1);
        harness.assertComplete();
    });

    test(`${platform} student: unknown existence data throws without creating`, async () => {
        const values = baseStudentValues();
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            negativeStep('IsStuExisted', officialResult({ unknown: true }), { accountList: [values.loginName] })
        ]);
        await assert.rejects(
            harness.adapter.commonReturnStudentBaseInfo(values),
            OfficialResponseParseError
        );
        assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsStuExisted']);
        assert.equal(harness.tickets.length, 0);
        harness.assertComplete();
    });

    test(`${platform} student: AddStudent failure is returned and no ticket is issued`, async () => {
        const values = baseStudentValues();
        const student = { studentID: values.loginName, password: 'train_1230', nickName: values.userName };
        const failure = officialResult(null, { code: 10010, succ: false, message: '新增失败' });
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: [values.loginName] }),
            staticStep('AddStudent', failure, addStudentParameters(platform, values, [student]))
        ]);
        assert.equal((await harness.adapter.commonReturnStudentBaseInfo(values)).code, 10010);
        assert.equal(harness.tickets.length, 0);
        assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsStuExisted', 'AddStudent']);
        harness.assertComplete();
    });

    test(`${platform} teacher: missing group, teacher and students creates in official order`, async () => {
        const values = baseTeacherValues();
        const original = structuredClone(values);
        const studentBeans = values.studentList.map(loginName => ({ studentID: loginName, password: 'train_123', nickName: loginName }));
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult(null), groupCheck(values)),
            staticStep('AddTrainGroup', officialResult('group-1'), groupCreate(values)),
            staticStep('IsTeacherExisted', officialResult('[]'), { accountList: [values.loginName] }),
            staticStep('AddTeacher', officialResult([values.loginName]), { groupID: 'group-1', teacherNameList: [values.loginName] }),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: values.studentList }),
            staticStep('AddStudent', officialResult(values.studentList), addStudentParameters(platform, values, studentBeans))
        ]);
        assert.equal(await harness.adapter.commonReturnTeacherBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), [
            'IsGroupExisted', 'AddTrainGroup', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
        ]);
        assert.deepEqual(values, original);
        assert.equal(harness.tickets.length, 1);
        harness.assertComplete();
    });

    test(`${platform} teacher: existing teacher adds only missing students without mutating input`, async () => {
        const values = baseTeacherValues();
        const original = structuredClone(values);
        const missing = values.studentList[1];
        const bean = { studentID: missing, password: 'train_123', nickName: missing };
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsTeacherExisted', officialResult([values.loginName]), { accountList: [values.loginName] }),
            staticStep('IsStuExisted', officialResult(JSON.stringify([values.studentList[0]])), { accountList: values.studentList }),
            staticStep('AddStudent', officialResult([missing]), addStudentParameters(platform, values, [bean]))
        ]);
        assert.equal(await harness.adapter.commonReturnTeacherBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), [
            'IsGroupExisted', 'IsTeacherExisted', 'IsStuExisted', 'AddStudent'
        ]);
        assert.deepEqual(values, original);
        assert.equal(harness.tickets.length, 1);
        harness.assertComplete();
    });

    test(`${platform} teacher: all accounts existing performs no creation`, async () => {
        const values = baseTeacherValues();
        const original = structuredClone(values);
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsTeacherExisted', officialResult([values.loginName]), { accountList: [values.loginName] }),
            staticStep('IsStuExisted', officialResult(values.studentList), { accountList: values.studentList })
        ]);
        assert.equal(await harness.adapter.commonReturnTeacherBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), [
            'IsGroupExisted', 'IsTeacherExisted', 'IsStuExisted'
        ]);
        assert.deepEqual(values, original);
        harness.assertComplete();
    });

    test(`${platform} teacher: empty studentList stops after teacher check`, async () => {
        const values = baseTeacherValues({ studentList: [] });
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsTeacherExisted', officialResult([values.loginName]), { accountList: [values.loginName] })
        ]);
        assert.equal(await harness.adapter.commonReturnTeacherBaseInfo(values), `TICKET:${values.loginName}`);
        assert.deepEqual(harness.calls.map(call => call.operationName), ['IsGroupExisted', 'IsTeacherExisted']);
        assert.deepEqual(values.studentList, []);
        harness.assertComplete();
    });

    test(`${platform} teacher: malformed teacher data throws before creation`, async () => {
        const values = baseTeacherValues();
        const original = structuredClone(values);
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            negativeStep('IsTeacherExisted', officialResult({ bad: true }), { accountList: [values.loginName] })
        ]);
        await assert.rejects(harness.adapter.commonReturnTeacherBaseInfo(values), OfficialResponseParseError);
        assert.equal(harness.tickets.length, 0);
        assert.deepEqual(values, original);
        harness.assertComplete();
    });

    test(`${platform} teacher: captured AddTeacher failure continues student provisioning`, async () => {
        const values = baseTeacherValues();
        const failure = officialResult(null, { code: 10010, succ: false, message: '教师创建失败' });
        const beans = values.studentList.map(loginName => ({
            studentID: loginName,
            password: 'train_123',
            nickName: loginName
        }));
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsTeacherExisted', officialResult('[]'), { accountList: [values.loginName] }),
            staticStep('AddTeacher', failure, { groupID: 'group-1', teacherNameList: [values.loginName] }),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: values.studentList }),
            staticStep('AddStudent', officialResult(values.studentList), addStudentParameters(platform, values, beans))
        ]);
        assert.equal(await harness.adapter.commonReturnTeacherBaseInfo(values), `TICKET:${values.loginName}`);
        assert.equal(harness.tickets.length, 1);
        assert.deepEqual(harness.calls.map(call => call.operationName), [
            'IsGroupExisted', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
        ]);
        harness.assertComplete();
    });

    test(`${platform} teacher: partial student creation failure returns failure`, async () => {
        const values = baseTeacherValues();
        const failure = officialResult([values.studentList[0]], {
            code: 10010,
            succ: false,
            message: '部分学生创建失败'
        });
        const beans = values.studentList.map(loginName => ({ studentID: loginName, password: 'train_123', nickName: loginName }));
        const harness = createHarness(platform, [
            staticStep('IsGroupExisted', officialResult('group-1'), groupCheck(values)),
            staticStep('IsTeacherExisted', officialResult([values.loginName]), { accountList: [values.loginName] }),
            staticStep('IsStuExisted', officialResult('[]'), { accountList: values.studentList }),
            staticStep('AddStudent', failure, addStudentParameters(platform, values, beans))
        ]);
        assert.equal((await harness.adapter.commonReturnTeacherBaseInfo(values)).code, 10010);
        assert.equal(harness.tickets.length, 0);
        assert.deepEqual(values.studentList, ['学生甲', '学生乙']);
        harness.assertComplete();
    });
}
