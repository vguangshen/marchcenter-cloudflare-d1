import assert from 'node:assert/strict';
import test from 'node:test';
import { executePlatformCompetitionEntry, preparePlatformCompetition } from '../../../server/utils/platformJumpDispatcher.js';

const baseUrl = 'https://fixture.invalid/contest';
const teacherContext = Object.freeze({
    user: { id: 17, username: 'contest-manager' },
    loginRole: 'teacher', loginName: 'contestTeacher', teacherUserName: 'contestTeacher',
    className: 'contestClass', studentList: ['contestStudentA', 'contestStudentB'],
    startTime: 1_800_000_000_000, endTime: 1_800_003_600_000, startExam: false
});

function javaFixture(respond) {
    const requests = [];
    const config = {
        method: 'java', officialBaseUrl: baseUrl, officialBaseUrlConfirmed: true, classType: 3,
        tokenNumber: 'fixture', tokenPassword: 'fixture'
    };
    const dependencies = {
        urlValidator: async () => undefined,
        official: {
            logger: { error() {} },
            fetchImplementation: async (url, options) => {
                const operation = new URL(url).pathname.split('/').at(-1);
                const fields = Object.fromEntries(new URLSearchParams(options.body));
                requests.push({ operation, fields });
                if (operation === 'tokenInfo') return Response.json({ code: 10000, succ: true, data: 'fixture-token' });
                return Response.json(respond(operation));
            }
        }
    };
    return { config, dependencies, requests };
}

test('Java prepares a unique teacher and seeds the contest class with the first attendee', async () => {
    const fixture = javaFixture(operation => ({
        code: 10000, succ: true, data: operation === 'getLoginTeacherName' ? 'fixture-ticket' : true
    }));
    const result = await preparePlatformCompetition(fixture.config, teacherContext, fixture.dependencies);
    assert.equal(result, undefined);
    assert.deepEqual(fixture.requests.map(({ operation }) => operation), ['tokenInfo', 'getLoginTeacherName', 'getUserName']);
    assert.equal(fixture.requests[1].fields.u, teacherContext.teacherUserName);
    const seed = fixture.requests[2].fields;
    assert.equal(seed.u, teacherContext.studentList[0]);
    assert.equal(seed.teacherUserName, teacherContext.teacherUserName);
    assert.equal(seed.className, teacherContext.className);
    assert.equal(seed.classMode, '3');
});

test('Java contest entry rejects unconfirmed student synchronization before requesting a ticket', async () => {
    const fixture = javaFixture(() => ({ code: 10002, succ: false, data: null }));
    await assert.rejects(executePlatformCompetitionEntry(fixture.config, {
        ...teacherContext, loginRole: 'student', loginName: teacherContext.studentList[1]
    }, fixture.dependencies), { code: 'OFFICIAL_JUMP_RESULT_FAILURE' });
    assert.deepEqual(fixture.requests.map(({ operation }) => operation), ['tokenInfo', 'getUserName']);
    assert.equal(fixture.requests[1].fields.className, teacherContext.className);
    assert.equal(fixture.requests[1].fields.teacherUserName, teacherContext.teacherUserName);
});

function soapFixture({ rejectTeacher = false } = {}) {
    const requests = [];
    const config = {
        method: 'net', officialBaseUrl: baseUrl, officialBaseUrlConfirmed: true, classType: 3,
        soapUsername: 'fixture', soapPassword: 'fixture'
    };
    const resultData = {
        IsGroupExisted: null, AddMegagameGroup: 'created-group', IsTeacherExisted: [],
        AddTeacher: [teacherContext.teacherUserName], IsStuExisted: [], AddStudent: teacherContext.studentList
    };
    const dependencies = {
        urlValidator: async () => undefined,
        official: {
            fetchImplementation: async (_url, options) => {
                const operation = options.headers.SOAPAction.split('/').at(-1).replace('"', '');
                requests.push({ operation, body: options.body });
                const failure = rejectTeacher && operation === 'AddTeacher';
                const result = JSON.stringify({ code: failure ? 10010 : 10000, succ: !failure, data: resultData[operation] });
                return new Response(
                    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><${operation}Response xmlns="http://tempuri.org/"><${operation}Result>${result}</${operation}Result></${operation}Response></soapenv:Body></soapenv:Envelope>`
                );
            }
        }
    };
    return { config, dependencies, requests };
}

test('SOAP prepares all confirmed attendees in the same new group without starting the platform exam', async () => {
    const fixture = soapFixture();
    await preparePlatformCompetition(fixture.config, teacherContext, fixture.dependencies);
    assert.deepEqual(fixture.requests.map(({ operation }) => operation), [
        'IsGroupExisted', 'AddMegagameGroup', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
    ]);
    assert.match(fixture.requests[1].body, /<groupName>contestClass<\/groupName>/);
    assert.match(fixture.requests[3].body, /<groupID>created-group<\/groupID>/);
    assert.match(fixture.requests[3].body, /<string>contestTeacher<\/string>/);
    const students = fixture.requests[5].body;
    assert.match(students, /<groupID>created-group<\/groupID>/);
    assert.match(students, /<startExam>false<\/startExam>/);
    assert.match(students, /<StudentID>contestStudentA<\/StudentID>/);
    assert.match(students, /<StudentID>contestStudentB<\/StudentID>/);
    const passwords = Array.from(students.matchAll(/<Password>(Q7[0-9a-f]{14})<\/Password>/g), match => match[1]);
    assert.equal(new Set(passwords).size, 2);
});

test('SOAP stops before student creation when the contest teacher was not confirmed', async () => {
    const fixture = soapFixture({ rejectTeacher: true });
    await assert.rejects(preparePlatformCompetition(fixture.config, teacherContext, fixture.dependencies), {
        code: 'OFFICIAL_COMPETITION_CLASS_PREPARATION_FAILED', status: 502,
        details: { method: 'net', serviceName: 'NetGeneralStandardInterfaceUtilService', operationName: 'AddTeacher', resultCode: 10010 }
    });
    assert.equal(fixture.requests.at(-1).operation, 'AddTeacher');
});
