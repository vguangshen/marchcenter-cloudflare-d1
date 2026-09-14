import { OfficialAdapterParameterError } from '../../errors.js';
import { buildCiphertext } from '../../ticketCodec.js';
import { OFFICIAL_SUCCESS } from '../../resultCodec.js';
import { createAxisSoapClient } from '../soapClient.js';
import {
    parseAccountExistence,
    parseAccountMutation,
    parseGroupExistence,
    parseGroupMutation
} from './resultParsers.js';

const LONG_MIN = -9223372036854775808n;
const LONG_MAX = 9223372036854775807n;
const CLASS_OPERATION = Object.freeze({
    1: 'AddTrainGroup',
    2: 'AddAppraisalGroup',
    3: 'AddMegagameGroup'
});
const MAX_RUN_YEAR_PROFILES = new Set([
    'marketing', 'commerce', 'managementAccounting', 'enterpriseManagement'
]);

function successResult(message = '成功') {
    const result = { code: OFFICIAL_SUCCESS, succ: true, message, data: true };
    return { ...result, raw: JSON.stringify(result) };
}

function normalizeClassType(value) {
    if (value === undefined || value === null) return 1;
    if (typeof value !== 'number' || !Number.isInteger(value)
        || value < -2147483648 || value > 2147483647) {
        throw new OfficialAdapterParameterError('classType 必须是 int 整数', {
            details: { field: 'classType', value }
        });
    }
    return value;
}

function normalizeInt(value, fieldName) {
    if (typeof value !== 'number' || !Number.isInteger(value)
        || value < -2147483648 || value > 2147483647) {
        throw new OfficialAdapterParameterError(`${fieldName} 必须是 int 整数`, {
            details: { field: fieldName, value }
        });
    }
    return value;
}

function normalizeBoolean(value, fieldName) {
    if (typeof value !== 'boolean') {
        throw new OfficialAdapterParameterError(`${fieldName} 必须是 boolean`, {
            details: { field: fieldName, value }
        });
    }
    return value;
}

function normalizeLong(value, fieldName) {
    let parsed;
    if (typeof value === 'bigint') parsed = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) parsed = BigInt(value);
    else if (typeof value === 'string' && /^-?\d+$/.test(value)) parsed = BigInt(value);
    else {
        throw new OfficialAdapterParameterError(`${fieldName} 必须是 Java long 整数`, {
            details: { field: fieldName, value }
        });
    }
    if (parsed < LONG_MIN || parsed > LONG_MAX) {
        throw new OfficialAdapterParameterError(`${fieldName} 超出 Java long 范围`, {
            details: { field: fieldName, value: String(value) }
        });
    }
    return parsed.toString();
}

function normalizeTimeRange(startTime, endTime) {
    const startPresent = startTime !== undefined && startTime !== null;
    const endPresent = endTime !== undefined && endTime !== null;
    if (!startPresent || !endPresent) return { st: 0, ed: 0 };
    return {
        st: normalizeLong(startTime, 'startTime'),
        ed: normalizeLong(endTime, 'endTime')
    };
}

function userIdText(value) {
    if (value === undefined || value === null) return 'null';
    return normalizeLong(value, 'userId');
}

function normalizeStudents(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new OfficialAdapterParameterError('studentList 必须是字符串数组、null 或 undefined');
    }
    return value.slice();
}

function platformStudentOptions(profileName, values) {
    if (profileName === 'net' || profileName === 'crossBorderCommerce') {
        const startExam = values.startExam === undefined || values.startExam === null
            ? true
            : normalizeBoolean(values.startExam, 'startExam');
        return { startExam };
    }
    if (profileName === 'marketing') {
        return {
            maxRunYear: normalizeInt(values.maxRunYear, 'maxRunYear'),
            autoDeal: normalizeBoolean(values.autoDeal, 'autoDeal')
        };
    }
    if (profileName === 'commerce' || profileName === 'managementAccounting'
        || profileName === 'enterpriseManagement') {
        const maxRunYear = values.maxRunYear === undefined || values.maxRunYear === null
            ? 0
            : normalizeInt(values.maxRunYear, 'maxRunYear');
        const autoDeal = values.autoDeal === undefined || values.autoDeal === null
            ? false
            : normalizeBoolean(values.autoDeal, 'autoDeal');
        return { maxRunYear, autoDeal };
    }
    throw new OfficialAdapterParameterError(`不支持的 SOAP profile: ${profileName}`);
}

function addStudentParameters(profileName, values, studentList, groupID) {
    const { st, ed } = normalizeTimeRange(values.startTime, values.endTime);
    return {
        studentList,
        groupID,
        st,
        ed,
        ...platformStudentOptions(profileName, values)
    };
}

export function createBaseSoapAdapter(options) {
    const { profileName, serviceName, baseUrl } = options;
    const soapClient = options.soapClient || createAxisSoapClient({
        fetchImplementation: options.fetchImplementation,
        credentials: options.credentials,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes
    });
    if (!soapClient || typeof soapClient.call !== 'function') {
        throw new TypeError('soapClient.call 必须是函数');
    }
    const ticketBuilder = options.ticketBuilder || buildCiphertext;
    const ticketType = options.ticketType ?? 'itmc';
    if (typeof ticketBuilder !== 'function') throw new TypeError('ticketBuilder 必须是函数');

    const call = (operationName, parameters) => soapClient.call({
        profileName,
        operationName,
        baseUrl,
        parameters
    });

    async function ensureGroup(values) {
        const classType = normalizeClassType(values.classType);
        const groupResponse = await call('IsGroupExisted', {
            groupName: values.className,
            groupID: ''
        });
        const group = parseGroupExistence(groupResponse);
        if (group.exists) return { status: 'success', groupID: group.groupID };

        const operationName = profileName === 'crossBorderCommerce'
            ? (classType === 3 ? 'AddMegagameGroup' : 'AddGroup')
            : (CLASS_OPERATION[classType] || 'AddTrainGroup');
        const creationResponse = await call(operationName, { groupName: values.className });
        return parseGroupMutation(operationName, creationResponse);
    }

    async function commonCheckTrain(values) {
        normalizeClassType(values.classType);
        if (MAX_RUN_YEAR_PROFILES.has(profileName)
            && values.maxRunYear !== undefined && values.maxRunYear !== null) {
            normalizeInt(values.maxRunYear, 'maxRunYear');
        }
        const group = await ensureGroup(values);
        if (group.status === 'failure') return group.result;

        const existenceResponse = await call('IsStuExisted', { accountList: [values.loginName] });
        const existence = parseAccountExistence('IsStuExisted', existenceResponse);
        if (existence.status === 'failure') return existence.result;
        if (existence.accounts.includes(values.loginName)) {
            return successResult('新增学生账号成功');
        }

        const studentList = [{
            studentID: values.loginName,
            password: `train_123${userIdText(values.userId)}`,
            nickName: values.userName
        }];
        const mutationResponse = await call('AddStudent', addStudentParameters(
            profileName,
            values,
            studentList,
            group.groupID
        ));
        const mutation = parseAccountMutation('AddStudent', mutationResponse);
        if (mutation.status === 'failure') return mutation.result;
        if (!mutation.accounts.includes(values.loginName)) return mutation.result;
        return successResult();
    }

    async function commonCheckTrainWithTeacher(values) {
        normalizeClassType(values.classType);
        if (MAX_RUN_YEAR_PROFILES.has(profileName)
            && values.maxRunYear !== undefined && values.maxRunYear !== null) {
            normalizeInt(values.maxRunYear, 'maxRunYear');
        }
        const requestedStudents = normalizeStudents(values.studentList);
        const group = await ensureGroup(values);
        if (group.status === 'failure') return group.result;

        const teacherResponse = await call('IsTeacherExisted', { accountList: [values.loginName] });
        const teacher = parseAccountExistence('IsTeacherExisted', teacherResponse);
        if (teacher.status === 'failure') return teacher.result;
        if (!teacher.accounts.includes(values.loginName)) {
            const addTeacherResponse = await call('AddTeacher', {
                groupID: group.groupID,
                teacherNameList: [values.loginName]
            });
            const addTeacher = parseAccountMutation('AddTeacher', addTeacherResponse);
            if (addTeacher.status === 'success'
                && !addTeacher.accounts.includes(values.loginName)) return addTeacher.result;
        }

        if (requestedStudents.length === 0) return successResult();
        const studentResponse = await call('IsStuExisted', { accountList: requestedStudents.slice() });
        const students = parseAccountExistence('IsStuExisted', studentResponse);
        if (students.status === 'failure') return students.result;
        const existing = new Set(students.accounts);
        const missingStudents = requestedStudents.filter(loginName => !existing.has(loginName));
        if (missingStudents.length === 0) return successResult();

        const studentBeans = missingStudents.map(loginName => ({
            studentID: loginName,
            password: 'train_123',
            nickName: loginName
        }));
        const addStudentResponse = await call('AddStudent', addStudentParameters(
            profileName,
            values,
            studentBeans,
            group.groupID
        ));
        const addStudent = parseAccountMutation('AddStudent', addStudentResponse);
        if (addStudent.status === 'failure') return addStudent.result;
        if (missingStudents.some(loginName => !addStudent.accounts.includes(loginName))) {
            return addStudent.result;
        }
        return successResult();
    }

    async function ticketAfterCheck(check, values) {
        const result = await check(values);
        if (result.code !== OFFICIAL_SUCCESS) return result;
        return ticketBuilder({
            studentID: values.loginName,
            password: '',
            nickName: ''
        }, ticketType);
    }

    async function deleteClassAccount(values) {
        const className = String(values?.className ?? '');
        if (!className) {
            throw new OfficialAdapterParameterError('className 不能为空', {
                details: { field: 'className' }
            });
        }
        const groupResponse = await call('IsGroupExisted', {
            groupName: className,
            groupID: ''
        });
        const group = parseGroupExistence(groupResponse);
        if (!group.exists) {
            // 班级已不存在视为幂等成功，不产生远端调用。
            return Object.freeze({ deleted: false, groupID: null, result: null });
        }
        const mutationResponse = await call('DelGroup', {
            groupIDList: [group.groupID]
        });
        return Object.freeze({ deleted: true, groupID: group.groupID, result: mutationResponse });
    }

    return Object.freeze({
        serviceName,
        profileName,
        evidenceLevel: 'official-static-derived',
        // Kept for profile-specific operations that are present in the
        // official WSDL but are not part of the high-level student/teacher
        // workflow. The caller still supplies a registered operation name and
        // the schema registry validates its exact parameters.
        callOperation: call,
        commonReturnTargetId: values => values.loginName,
        commonGetLoginName: values => `${values.loginName}_${values.epuId}`,
        commonCheckTrain,
        commonCheckTrainWithTeacher,
        commonReturnStudentBaseInfo: values => ticketAfterCheck(commonCheckTrain, values),
        commonReturnTeacherBaseInfo: values => ticketAfterCheck(commonCheckTrainWithTeacher, values),
        deleteStudentAccount: values => call('MarkStuDeleted', {
            studentIDList: [values.loginName]
        }),
        deleteClassAccount
    });
}
