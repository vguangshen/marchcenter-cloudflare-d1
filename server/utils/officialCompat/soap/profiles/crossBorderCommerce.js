import { defineProfile } from './profileFactory.js';

// Kuajingdianshang Axis Stub, official-captured
// (fixtures: tests/official-parity/soap-business/fixtures/official-cross-border-commerce-captures.json).
export const crossBorderCommerceProfile = defineProfile('crossBorderCommerce', [
    ['IsGroupExisted', [['groupName', 'string'], ['groupID', 'string']]],
    ['AddMegagameGroup', [['groupName', 'string']]],
    ['AddGroup', [['groupName', 'string']]],
    ['IsTeacherExisted', [['accountList', 'ArrayOfString']]],
    ['IsStuExisted', [['accountList', 'ArrayOfString']]],
    ['AddTeacher', [['groupID', 'string'], ['teacherNameList', 'ArrayOfString']]],
    ['AddStudent', [['studentList', 'ArrayOfStudentBaseClass'], ['groupID', 'string'], ['st', 'long'], ['ed', 'long'], ['startExam', 'boolean']]],
    ['StartExam', [['groupID', 'string'], ['st', 'long'], ['ed', 'long']]],
    ['CloseStudent', [['studentIDList', 'ArrayOfString']]],
    ['OpenStudent', [['studentIDList', 'ArrayOfString']]],
    ['ResetStuEndTime', [['studentID', 'string'], ['endTime', 'long']]],
    ['PauseExam', [['groupID', 'string']]],
    ['ContinueExam', [['groupID', 'string']]],
    ['EndExam', [['groupID', 'string']]],
    ['GetExamState', [['groupIDList', 'ArrayOfString']]],
    ['IsFinishedExam', [['studentIDList', 'ArrayOfString']]],
    ['GetStuTagNameScore', [['studentIDList', 'ArrayOfString']]],
    ['GetStuBasedata', [['groupID', 'string']]],
    ['ComputeStuFinalScore', [['basedataList', 'ArrayOfStuBaseDataClass']]],
    ['GetStuTrainScore', [['studentIDList', 'ArrayOfString']]],
    ['GetStuTrainDoneInfo', [['studentIDList', 'ArrayOfString']]],
    ['GetStuTrainImgReport', [['studentID', 'string'], ['userName', 'string'], ['cardNum', 'string'], ['reportTitle', 'string']]],
    ['MarkGroupDeleted', [['groupID', 'string']]],
    ['MarkStuDeleted', [['studentIDList', 'ArrayOfString']]],
    ['DelGroup', [['groupIDList', 'ArrayOfString']]],
    ['DelStudent', [['studentIDList', 'ArrayOfString']]],
    ['GetSystemInfo'],
    ['GetSystemSuportVersionInfo']
]);
