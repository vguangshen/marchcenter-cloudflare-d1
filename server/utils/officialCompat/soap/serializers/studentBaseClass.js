import { serializeOrderedBeanArray } from './commonTypes.js';

const STUDENT_FIELDS = Object.freeze([
    { key: 'studentID', xmlName: 'StudentID', type: 'string', required: false },
    { key: 'password', xmlName: 'Password', type: 'string', required: false },
    { key: 'nickName', xmlName: 'NickName', type: 'string', required: false }
]);

export function serializeStudentBaseClassArray(parameterName, value, itemName = 'StudentBaseClass') {
    return serializeOrderedBeanArray(parameterName, value, itemName, STUDENT_FIELDS);
}

