import { OfficialAdapterParameterError } from './errors.js';

export const OFFICIAL_JUMP_PARAMETER_NAMES = Object.freeze([
    'loginName',
    'className',
    'teacherUserName',
    'startTime',
    'endTime',
    'flag',
    'trainOrExam',
    'userId',
    'userName',
    'startExam',
    'classType',
    'maxRunYear',
    'autoDeal',
    'roleName',
    'teamName',
    'studentList',
    'baseUrl'
]);

export const OFFICIAL_COMMON_METHOD_SCHEMAS = Object.freeze({
    commonReturnTargetId: Object.freeze(['loginName']),
    commonGetLoginName: Object.freeze(['loginName', 'epuId']),
    commonCheckTrain: Object.freeze([
        'userId', 'loginName', 'userName', 'startTime', 'endTime', 'startExam',
        'className', 'classType', 'maxRunYear', 'autoDeal'
    ]),
    commonCheckTrainWithTeacher: Object.freeze([
        'userId', 'loginName', 'userName', 'startTime', 'endTime', 'startExam',
        'className', 'classType', 'studentList', 'maxRunYear', 'autoDeal'
    ]),
    commonReturnTeacherBaseInfo: Object.freeze([
        'loginName', 'className', 'userId', 'userName', 'startTime', 'endTime',
        'startExam', 'classType', 'studentList', 'maxRunYear', 'autoDeal',
        'roleName', 'teamName'
    ]),
    commonReturnStudentBaseInfo: Object.freeze([
        'loginName', 'className', 'teacherUserName', 'startTime', 'endTime',
        'flag', 'trainOrExam', 'userId', 'userName', 'startExam', 'classType',
        'maxRunYear', 'autoDeal', 'roleName', 'teamName'
    ])
});

export function mapOfficialJumpParameters(methodName, source) {
    const schema = OFFICIAL_COMMON_METHOD_SCHEMAS[methodName];
    if (!schema) {
        throw new OfficialAdapterParameterError(`未登记参数 schema: ${methodName}`);
    }
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
        throw new OfficialAdapterParameterError('跳转参数必须是对象');
    }
    const mapped = {};
    for (const name of schema) mapped[name] = source[name];
    return mapped;
}
