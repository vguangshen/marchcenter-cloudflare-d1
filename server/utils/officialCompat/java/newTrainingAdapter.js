import { OfficialJavaResponseError } from '../errors.js';
import { OFFICIAL_FAILURE, OFFICIAL_SUCCESS } from '../resultCodec.js';
import { createJavaHttpTransport } from './javaHttpTransport.js';
import { parseJavaResult, requireJavaResultData } from './javaResultParser.js';
import { javaUrlDecode, javaUrlEncode } from './formCodec.js';
import { createJavaTokenClient } from './tokenClient.js';
import { buildConfirmedJavaOpenBaseUrl } from '../officialJumpConfig.js';

export const NEW_TRAINING_SERVICE_NAME = 'NewTrainingInterfaceUtilService';

function resultWithData(result, data) {
    return { ...result, data };
}

function javaNonEmpty(value) {
    return value !== null && value !== undefined && value !== '';
}

function getUserValues(parameters, includeClassMode) {
    const values = {
        teamName: parameters.teamName,
        u: parameters.loginName,
        roleName: parameters.roleName,
        className: parameters.className,
        teacherUserName: parameters.teacherUserName
    };
    if (includeClassMode && parameters.classType !== null && parameters.classType !== undefined) {
        values.classMode = String(parameters.classType);
    }
    return values;
}

export function createNewTrainingAdapter(options = {}) {
    const baseUrl = options.baseUrl;
    if (baseUrl === null || baseUrl === undefined || baseUrl === '') throw new TypeError('baseUrl 必填');
    const openBaseUrl = buildConfirmedJavaOpenBaseUrl(baseUrl);
    const transport = options.transport || createJavaHttpTransport({
        fetchImplementation: options.fetchImplementation,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes
    });
    const tokenClient = options.tokenClient || createJavaTokenClient({
        openBaseUrl,
        tokenStore: options.tokenStore,
        transport,
        credentials: options.credentials
    });

    const invoke = async (operationName, values) => {
        const token = await tokenClient.getToken();
        const raw = await transport.post({ openBaseUrl, operationName, platformToken: token, values });
        return parseJavaResult(raw, operationName);
    };

    return Object.freeze({
        serviceName: NEW_TRAINING_SERVICE_NAME,
        openBaseUrl,
        commonReturnTargetId({ loginName }) {
            return loginName;
        },
        commonGetLoginName({ loginName, epuId }) {
            return `${loginName}_${epuId}`;
        },
        async commonReturnStudentBaseInfo(parameters) {
            if (parameters.accountWasReady !== true) {
                const userResult = await invoke('getUserName', getUserValues(parameters, true));
                if (userResult.code === OFFICIAL_FAILURE) {
                    throw new OfficialJavaResponseError(javaUrlDecode(userResult.message), {
                        operationName: 'getUserName', raw: userResult.raw, code: 'OFFICIAL_JAVA_USER_SYNC_FAILURE'
                    });
                }
            }

            const operationName = javaNonEmpty(parameters.trainOrExam) && parameters.trainOrExam === 'exam'
                ? 'trainingExamPaperV2'
                : 'trainingExamPaper';
            const ticketResult = await invoke(operationName, {
                st: parameters.startTime,
                flag: parameters.flag,
                u: parameters.loginName,
                ed: parameters.endTime
            });
            if (ticketResult.code !== OFFICIAL_SUCCESS) return ticketResult;
            const ticket = requireJavaResultData(ticketResult, operationName);
            if (typeof ticket !== 'string') {
                throw new OfficialJavaResponseError(`${operationName}.data 必须是字符串`, {
                    operationName, raw: ticketResult.raw, code: 'OFFICIAL_JAVA_TICKET_DATA_TYPE'
                });
            }
            return resultWithData(ticketResult, `u=${javaUrlEncode(ticket)}`);
        },
        async commonReturnTeacherBaseInfo(parameters) {
            const teacherResult = await invoke('getLoginTeacherName', { u: parameters.loginName });
            const students = parameters.studentList;
            if (parameters.accountWasReady !== true
                && students !== null && students !== undefined && students.length !== 0) {
                for (const studentLoginName of students) {
                    // Official bug: classMode is written to the teacher map and never reaches this request.
                    const studentResult = await invoke('getUserName', getUserValues({
                            ...parameters,
                            loginName: studentLoginName,
                            teacherUserName: parameters.loginName
                        }, false));
                    if (studentResult.code !== OFFICIAL_SUCCESS) return studentResult;
                }
            }
            if (teacherResult.code !== OFFICIAL_SUCCESS) return teacherResult;
            const teacherTicket = requireJavaResultData(teacherResult, 'getLoginTeacherName');
            if (typeof teacherTicket !== 'string') {
                throw new OfficialJavaResponseError('getLoginTeacherName.data 必须是字符串', {
                    operationName: 'getLoginTeacherName', raw: teacherResult.raw,
                    code: 'OFFICIAL_JAVA_TEACHER_DATA_TYPE'
                });
            }
            let data = `teacherUserName=${javaUrlEncode(teacherTicket)}`;
            if (javaNonEmpty(parameters.className)) data += `&className=${parameters.className}`;
            if (parameters.classType !== null && parameters.classType !== undefined) {
                data += `&classMode=${parameters.classType}`;
            }
            return resultWithData(teacherResult, data);
        },
        async deleteStudentAccount({ loginName }) {
            return invoke('delStudentDataQueue', { u: loginName });
        },
        async reinitializeModule() {
            // 模块初始化：无参数，清空该训练平台实例上的全部班级/账号/成绩。
            const result = await invoke('reinitializeSystem', {});
            if (result.code !== OFFICIAL_SUCCESS) {
                return Object.freeze({ initialized: false, result });
            }
            return Object.freeze({ initialized: true, result });
        }
    });
}
