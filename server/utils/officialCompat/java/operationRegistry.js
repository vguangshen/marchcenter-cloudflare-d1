const operation = (operationName, path, parameters, evidenceLevel = 'official-captured') => Object.freeze({
    operationName,
    path,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    parameters: Object.freeze(parameters.map(parameter => Object.freeze({ ...parameter }))),
    header: 'platformToken',
    resultModel: 'Result JSON string',
    evidenceLevel
});

const optional = name => ({ name, required: false, nullWire: 'bare-name' });

export const JAVA_OPERATION_REGISTRY = Object.freeze({
    tokenInfo: operation('tokenInfo', '/tokenInfo', []),
    getUserName: operation('getUserName', '/getUserName', [
        optional('teamName'), optional('classMode'), optional('u'),
        optional('roleName'), optional('className'), optional('teacherUserName')
    ]),
    getLoginTeacherName: operation('getLoginTeacherName', '/getLoginTeacherName', [optional('u')]),
    trainingExamPaper: operation('trainingExamPaper', '/trainingExamPaper', [
        optional('st'), optional('flag'), optional('u'), optional('ed')
    ]),
    trainingExamPaperV2: operation('trainingExamPaperV2', '/trainingExamPaperV2', [
        optional('st'), optional('flag'), optional('u'), optional('ed')
    ]),
    delStudentDataQueue: operation('delStudentDataQueue', '/delStudentDataQueue', [
        optional('u')
    ], 'official-static-derived'),
    checkClass: operation('checkClass', '/checkClass', [
        optional('u')
    ]),
    checkClassName: operation('checkClassName', '/checkClassName', [
        optional('u')
    ]),
    markGroupDeleted: operation('markGroupDeleted', '/markGroupDeleted', [
        optional('u')
    ]),
    delDataByClassName: operation('delDataByClassName', '/delDataByClassName', [
        optional('u')
    ]),
    reinitializeSystem: operation('reinitializeSystem', '/reinitializeSystem', [])
});

export function getJavaOperation(name) {
    const schema = JAVA_OPERATION_REGISTRY[name];
    if (!schema) throw new RangeError(`未登记 JAVA 操作: ${name}`);
    return schema;
}

export function orderJavaOperationParameters(name, values) {
    const schema = getJavaOperation(name);
    return schema.parameters
        .filter(parameter => Object.prototype.hasOwnProperty.call(values, parameter.name))
        .map(parameter => [parameter.name, values[parameter.name]]);
}
