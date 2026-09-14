import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagementAccountingAdapter } from '../../../server/utils/officialCompat/soap/adapters/managementAccountingAdapter.js';
import { createCrossBorderCommerceAdapter } from '../../../server/utils/officialCompat/soap/adapters/crossBorderCommerceAdapter.js';
import { createEnterpriseManagementAdapter } from '../../../server/utils/officialCompat/soap/adapters/enterpriseManagementAdapter.js';

const FACTORIES = {
    managementAccounting: createManagementAccountingAdapter,
    crossBorderCommerce: createCrossBorderCommerceAdapter,
    enterpriseManagement: createEnterpriseManagementAdapter
};

const result = data => ({ code: 10000, succ: true, message: '成功', data });
const values = (overrides = {}) => ({
    loginName: '学生甲', className: '新平台班级', userId: '9223372036854775807',
    userName: '姓名&甲', startTime: '0', endTime: '9223372036854775807',
    classType: 1, maxRunYear: 0, autoDeal: false, startExam: null,
    ...overrides
});

function harness(profileName, expected) {
    const calls = [];
    const soapClient = {
        async call(request) {
            calls.push(request);
            const step = expected[calls.length - 1];
            assert.ok(step, `unexpected ${request.operationName}`);
            assert.equal(request.profileName, profileName);
            assert.equal(request.operationName, step.operationName);
            assert.deepEqual(request.parameters, step.parameters);
            return step.result;
        }
    };
    return {
        adapter: FACTORIES[profileName]({ baseUrl: 'http://mock.invalid', soapClient }),
        calls
    };
}

for (const profileName of ['managementAccounting', 'enterpriseManagement']) {
    test(`${profileName} student flow preserves zero, false and Java long`, async () => {
        const input = values();
        const bean = { studentID: input.loginName, password: `train_123${input.userId}`, nickName: input.userName };
        const expected = [
            { operationName: 'IsGroupExisted', parameters: { groupName: input.className, groupID: '' }, result: result(null) },
            { operationName: 'AddTrainGroup', parameters: { groupName: input.className }, result: result('g-1') },
            { operationName: 'IsStuExisted', parameters: { accountList: [input.loginName] }, result: result('[]') },
            { operationName: 'AddStudent', parameters: {
                studentList: [bean], groupID: 'g-1', st: '0', ed: '9223372036854775807',
                maxRunYear: 0, autoDeal: false
            }, result: result([input.loginName]) }
        ];
        const testHarness = harness(profileName, expected);
        assert.equal((await testHarness.adapter.commonCheckTrain(input)).code, 10000);
        assert.equal(testHarness.calls.length, 4);
    });
}

for (const [classType, operationName] of [[1, 'AddGroup'], [2, 'AddGroup'], [3, 'AddMegagameGroup']]) {
    test(`crossBorderCommerce classType ${classType} selects ${operationName}`, async () => {
        const input = values({ classType });
        const bean = { studentID: input.loginName, password: `train_123${input.userId}`, nickName: input.userName };
        const expected = [
            { operationName: 'IsGroupExisted', parameters: { groupName: input.className, groupID: '' }, result: result(null) },
            { operationName, parameters: { groupName: input.className }, result: result('g-2') },
            { operationName: 'IsStuExisted', parameters: { accountList: [input.loginName] }, result: result([]) },
            { operationName: 'AddStudent', parameters: {
                studentList: [bean], groupID: 'g-2', st: '0', ed: '9223372036854775807', startExam: true
            }, result: result([input.loginName]) }
        ];
        const testHarness = harness('crossBorderCommerce', expected);
        assert.equal((await testHarness.adapter.commonCheckTrain(input)).code, 10000);
        assert.equal(testHarness.calls.length, 4);
    });
}

for (const profileName of Object.keys(FACTORIES)) {
    test(`${profileName} teacher flow creates teacher then only missing students`, async () => {
        const input = values({
            loginName: '教师甲', studentList: ['学生甲', '学生乙'],
            userId: '9', userName: '教师姓名'
        });
        const beans = input.studentList.map(studentID => ({
            studentID, password: 'train_123', nickName: studentID
        }));
        const addStudent = {
            studentList: beans, groupID: 'g-teacher', st: '0', ed: '9223372036854775807',
            ...(profileName === 'crossBorderCommerce'
                ? { startExam: true }
                : { maxRunYear: 0, autoDeal: false })
        };
        const expected = [
            { operationName: 'IsGroupExisted', parameters: { groupName: input.className, groupID: '' }, result: result('g-teacher') },
            { operationName: 'IsTeacherExisted', parameters: { accountList: [input.loginName] }, result: result([]) },
            { operationName: 'AddTeacher', parameters: { groupID: 'g-teacher', teacherNameList: [input.loginName] }, result: result([input.loginName]) },
            { operationName: 'IsStuExisted', parameters: { accountList: input.studentList }, result: result([]) },
            { operationName: 'AddStudent', parameters: addStudent, result: result(input.studentList) }
        ];
        const testHarness = harness(profileName, expected);
        assert.equal((await testHarness.adapter.commonCheckTrainWithTeacher(input)).code, 10000);
        assert.equal(testHarness.calls.length, 5);
        assert.deepEqual(input.studentList, ['学生甲', '学生乙']);
    });
}
