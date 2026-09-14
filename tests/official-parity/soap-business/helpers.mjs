import assert from 'node:assert/strict';
import { createCommerceAdapter } from '../../../server/utils/officialCompat/soap/adapters/commerceAdapter.js';
import { createMarketingAdapter } from '../../../server/utils/officialCompat/soap/adapters/marketingAdapter.js';
import { createNetAdapter } from '../../../server/utils/officialCompat/soap/adapters/netAdapter.js';

export const STATIC_EVIDENCE = 'official-static-derived';
export const NEGATIVE_EVIDENCE = 'synthetic-negative-test';
export const CAPTURED_EVIDENCE = 'official-captured';

const FACTORIES = Object.freeze({
    net: createNetAdapter,
    marketing: createMarketingAdapter,
    commerce: createCommerceAdapter
});

export const PLATFORMS = Object.freeze(Object.keys(FACTORIES));

export function officialResult(data, overrides = {}) {
    return {
        code: overrides.code ?? 10000,
        succ: overrides.succ ?? true,
        message: overrides.message ?? '成功',
        data
    };
}

export function staticStep(operationName, result, expectedParameters) {
    return { operationName, result, expectedParameters, evidenceLevel: STATIC_EVIDENCE };
}

export function negativeStep(operationName, result, expectedParameters) {
    return { operationName, result, expectedParameters, evidenceLevel: NEGATIVE_EVIDENCE };
}

export function baseStudentValues(overrides = {}) {
    return {
        loginName: '学生甲',
        className: '竞赛班&一',
        teacherUserName: '教师甲',
        startTime: '10',
        endTime: '20',
        flag: '',
        trainOrExam: 'train',
        userId: 0,
        userName: '姓名<甲>',
        startExam: null,
        classType: 1,
        maxRunYear: 0,
        autoDeal: false,
        roleName: null,
        teamName: '',
        ...overrides
    };
}

export function baseTeacherValues(overrides = {}) {
    return {
        loginName: '教师甲',
        className: '竞赛班&一',
        userId: 9,
        userName: '教师姓名',
        startTime: '10',
        endTime: '20',
        startExam: null,
        classType: 1,
        studentList: ['学生甲', '学生乙'],
        maxRunYear: 0,
        autoDeal: false,
        roleName: null,
        teamName: '',
        ...overrides
    };
}

export function addStudentParameters(platform, values, students, groupID = 'group-1') {
    const common = {
        studentList: students,
        groupID,
        st: values.startTime !== undefined && values.startTime !== null
            && values.endTime !== undefined && values.endTime !== null ? String(values.startTime) : 0,
        ed: values.startTime !== undefined && values.startTime !== null
            && values.endTime !== undefined && values.endTime !== null ? String(values.endTime) : 0
    };
    if (platform === 'net') return { ...common, startExam: values.startExam ?? true };
    if (platform === 'marketing') {
        return { ...common, maxRunYear: values.maxRunYear, autoDeal: values.autoDeal };
    }
    return { ...common, maxRunYear: values.maxRunYear ?? 0, autoDeal: values.autoDeal ?? false };
}

export function createHarness(platform, steps, options = {}) {
    const calls = [];
    const tickets = [];
    let index = 0;
    const soapClient = {
        async call(request) {
            calls.push(request);
            const step = steps[index];
            index += 1;
            assert.ok(step, `收到未预期操作 ${request.operationName}`);
            assert.ok(
                [STATIC_EVIDENCE, NEGATIVE_EVIDENCE, CAPTURED_EVIDENCE].includes(step.evidenceLevel),
                `${step.operationName} fixture 缺少 evidenceLevel`
            );
            assert.equal(request.operationName, step.operationName);
            assert.equal(request.profileName, platform);
            assert.equal(request.baseUrl, 'http://mock.invalid');
            assert.deepEqual(request.parameters, step.expectedParameters);
            if (step.error) throw step.error;
            return step.result;
        }
    };
    const adapterOptions = {
        soapClient,
        baseUrl: 'http://mock.invalid'
    };
    if (!options.useRealTicket) {
        adapterOptions.ticketBuilder = (student, ticketType) => {
            tickets.push({ student: { ...student }, ticketType });
            return `TICKET:${student.studentID}`;
        };
    }
    const adapter = FACTORIES[platform](adapterOptions);
    return {
        adapter,
        calls,
        tickets,
        assertComplete() {
            assert.equal(index, steps.length, '仍有 mock 步骤未调用');
        }
    };
}
