import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfficialDependencyFactory } from '../../../server/utils/officialCompat/officialDependencyFactory.js';
import { executeOfficialJump, planOfficialJump } from '../../../server/utils/officialCompat/officialJumpExecutor.js';
import { executePlatformJump, planPlatformJump } from '../../../server/utils/platformJumpDispatcher.js';

const BASE = 'https://vendor.invalid/DS50108';

function harness(resultData = 'ABC123') {
    const calls = [];
    const credentialCalls = [];
    const logs = [];
    const trainingEntrance = {
        async executeNew(request) {
            calls.push(request);
            return { code: 10000, succ: true, message: '成功', data: resultData, raw: '{}' };
        }
    };
    const dependencies = createOfficialDependencyFactory({
        fetchImplementation: async () => { throw new Error('network must not run'); },
        credentialsProvider: {
            async getCredentials(request) {
                credentialCalls.push(request.method);
                return request.method === 'java'
                    ? { tokenNum: 'LOCAL', password: 'LOCAL' }
                    : { username: 'LOCAL', password: 'LOCAL' };
            }
        },
        logger: { error(value) { logs.push(value); } },
        trainingEntrance
    });
    return { calls, credentialCalls, logs, dependencies };
}

test('official direct returns its validated input unchanged', async () => {
    const subject = harness();
    const url = `${BASE}/entry`;
    const output = await executePlatformJump({ officialBaseUrlConfirmed: true, method: 'direct', officialBaseUrl: url }, {}, {
        urlValidator: async () => undefined,
        officialDependencies: subject.dependencies
    });
    assert.equal(output, url); assert.equal(subject.calls.length, 0); assert.equal(subject.credentialCalls.length, 0);
});

test('official JAVA teacher execution uses the teacherIndex entry', async () => {
    const subject = harness('teacherUserName=teacher%2Bticket&className=mc-user&classMode=1');
    const output = await executeOfficialJump({
        officialBaseUrlConfirmed: true, method: 'java',
        officialBaseUrl: BASE, tokenNumber: 'stored', tokenPassword: 'stored'
    }, {
        loginRole: 'teacher',
        user: { id: '1', username: 'march-user', name: '教师' },
        studentList: []
    }, subject.dependencies);
    assert.equal(
        output,
        `${BASE}/open/teacherIndex?needTheoryScore=1&teacherUserName=teacher%2Bticket&className=mc-user&classMode=1`
    );
});

test('official SOAP teacher execution appends the teacher theory-score flag', async () => {
    const subject = harness('AABBCC');
    const output = await executeOfficialJump({
        officialBaseUrlConfirmed: true, method: 'commerce',
        officialBaseUrl: BASE, soapUsername: 'stored', soapPassword: 'stored'
    }, {
        loginRole: 'teacher',
        user: { id: '1', username: 'march-user', name: '教师' },
        studentList: []
    }, subject.dependencies);
    assert.equal(output, `${BASE}/Login.aspx?type=itmc&data=AABBCC&needTheoryScore=1`);
});

const services = {
    java: 'NewTrainingInterfaceUtilService',
    net: 'NetGeneralStandardInterfaceUtilService',
    marketing: 'ShichangyingxiaoshapanInterfaceUtilService',
    commerce: 'WangdianyunyingtuiguangGJshapanInterfaceUtilService',
    managementAccounting: 'GuanlikuaijiGJshapanInterfaceUtilService',
    crossBorderCommerce: 'KuajingdianshangshapanInterfaceUtilService',
    enterpriseManagement: 'QiyeguanlishapanInterfaceUtilService'
};

for (const [method, serviceName] of Object.entries(services)) {
    test(`official ${method} uses exact service mapping`, async () => {
        const resultData = method === 'java' ? 'u=ticket+%2B%25' : 'A1B2C3D4';
        const subject = harness(resultData);
        const output = await executePlatformJump({
            officialBaseUrlConfirmed: true, method, officialBaseUrl: BASE,
            tokenNumber: 'stored', tokenPassword: 'stored', soapUsername: 'stored', soapPassword: 'stored',
            className: 'class', teacherUserName: 'teacher', flag: '', trainOrExam: 'train',
            startExam: false, classType: 1, maxRunYear: 0, autoDeal: false,
            roleName: null, teamName: ''
        }, {
            user: { id: '9223372036854775807', username: 'user', name: '姓名' },
            loginName: 'login', startTime: '0', endTime: null
        }, {
            urlValidator: async () => undefined,
            officialDependencies: subject.dependencies
        });
        assert.equal(subject.calls.length, 1);
        assert.equal(subject.calls[0].serviceName, serviceName);
        assert.equal(subject.calls[0].methodName, 'commonReturnStudentBaseInfo');
        assert.equal(subject.calls[0].parameters.userId, '9223372036854775807');
        assert.equal(subject.calls[0].parameters.startExam, false);
        assert.equal(subject.calls[0].parameters.maxRunYear, 0);
        assert.equal(subject.calls[0].parameters.autoDeal, false);
        assert.equal(subject.calls[0].parameters.endTime, null);
        assert.equal(subject.calls[0].parameters.flag, '');
        assert.equal(subject.calls[0].parameters.baseUrl, BASE);
        assert.equal(output, method === 'java'
            ? `${BASE}/open/enterIndex?u=ticket+%2B%25`
            : `${BASE}/Login.aspx?type=itmc&data=A1B2C3D4`);
    });
}

test('MarchCenter composition supplies official zero/false defaults to six-parameter sandboxes', () => {
    for (const method of ['marketing', 'commerce', 'managementAccounting', 'enterpriseManagement']) {
        const plan = planOfficialJump({
            officialBaseUrlConfirmed: true,
            method, officialBaseUrl: BASE, className: 'class', teacherUserName: 'teacher'
        }, { user: { id: '1', username: 'u', name: 'U' } });
        assert.equal(plan.parameters.maxRunYear, 0);
        assert.equal(plan.parameters.autoDeal, false);
    }
});

test('official card execution binds generated class and teacher accounts to the MarchCenter username', () => {
    const baseConfig = {
        officialBaseUrlConfirmed: true,
        method: 'commerce', officialBaseUrl: BASE,
        className: '默认班级', teacherUserName: 'teacher',
        classPrefix: 'mc', teacherPrefix: 'mc', studentPrefix: 'mcs', studentSuffix: '1'
    };
    const teacherPlan = planOfficialJump(baseConfig, {
        user: { username: 'march-user' }, loginRole: 'teacher'
    });
    assert.equal(teacherPlan.parameters.className, 'mcmarch-user');
    assert.equal(teacherPlan.parameters.teacherUserName, 'mcmarch-user');
    assert.equal(teacherPlan.parameters.loginName, 'mcmarch-user');

    const studentPlan = planOfficialJump(baseConfig, {
        user: { username: 'march-user' }, loginRole: 'student', studentIndex: 1
    });
    assert.equal(studentPlan.parameters.className, 'mcmarch-user');
    assert.equal(studentPlan.parameters.teacherUserName, 'mcmarch-user');
    assert.equal(studentPlan.parameters.loginName, 'mcs' + 'march-user1');
});

test('ready SOAP account uses a local ticket without remote checks', async () => {
    const subject = harness('TICKET');
    const redirectUrl = await executeOfficialJump({
        method: 'net', officialBaseUrl: BASE,
        soapUsername: 'stored', soapPassword: 'stored'
    }, { user: { id: '1', username: 'u' }, accountWasReady: true }, subject.dependencies);
    assert.match(redirectUrl, new RegExp(`^${BASE}/Login\\.aspx\\?type=itmc&data=[A-F0-9]+$`));
    assert.equal(subject.calls.length, 0);
});

test('JAVA result.data and SOAP hex tickets are not encoded a second time', async () => {
    const java = harness('u=a+b%2Bc%25');
    assert.equal(await executeOfficialJump({ method: 'java', officialBaseUrl: BASE }, {}, java.dependencies),
        `${BASE}/open/enterIndex?u=a+b%2Bc%25`);
    const soap = harness('ABCD0123&RAW');
    assert.equal(await executeOfficialJump({ method: 'commerce', officialBaseUrl: BASE }, {}, soap.dependencies),
        `${BASE}/Login.aspx?type=itmc&data=ABCD0123&RAW`);
});

test('pure plan maps zero, false, null, empty and long without network or credentials', () => {
    const plan = planPlatformJump({
        method: 'java', officialBaseUrl: BASE,
        flag: '', startExam: false, classType: null, maxRunYear: 0, autoDeal: false,
        teamName: '', roleName: null, trainOrExam: 'exam'
    }, {
        loginName: 'student', userId: '9223372036854775807', startTime: 0, endTime: null,
        studentList: []
    });
    assert.equal(plan.parameters.flag, '');
    assert.equal(plan.parameters.startExam, false);
    assert.equal(plan.parameters.classType, null);
    assert.equal(plan.parameters.maxRunYear, 0);
    assert.equal(plan.parameters.autoDeal, false);
    assert.equal(plan.parameters.startTime, 0);
    assert.equal(plan.parameters.endTime, null);
    assert.equal(plan.parameters.userId, '9223372036854775807');
    assert.deepEqual(plan.parameters.studentList, []);
    assert.ok(plan.expectedSteps.includes('trainingExamPaperV2'));
});

test('plan rejects unconfirmed full SOAP interface instead of trimming it', () => {
    assert.throws(() => planOfficialJump({
        method: 'net', officialBaseUrl: `${BASE}/NormWebService.asmx`
    }), { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' });
});

test('logged official errors contain only safe routing metadata', async () => {
    const subject = harness();
    subject.dependencies.trainingEntrance.executeNew = async () => {
        throw Object.assign(new Error('secret failure'), { code: 'REMOTE_FAILED', stage: 'soap-http' });
    };
    await assert.rejects(executeOfficialJump({ method: 'net', officialBaseUrl: BASE }, {}, subject.dependencies), {
        code: 'REMOTE_FAILED'
    });
    assert.deepEqual(subject.logs, [{
        adapter: 'official-compat',
        method: 'net',
        serviceName: 'NetGeneralStandardInterfaceUtilService', operationStage: 'soap-http',
        targetHost: 'vendor.invalid', commonMethod: 'commonReturnStudentBaseInfo', code: 'REMOTE_FAILED'
    }]);
    assert.doesNotMatch(JSON.stringify(subject.logs), /password|token|ticket|secret failure/i);
});

test('failed SOAP Result logs its operation and safe diagnostic fields', async () => {
    const subject = harness();
    const failure = {
        code: 10010,
        succ: false,
        message: '对不起，您无权调用此接口！ password=super-secret token: hidden-token',
        data: 'SENSITIVE-TICKET'
    };
    Object.defineProperty(failure, 'operationName', { value: 'IsGroupExisted', enumerable: false });
    subject.dependencies.trainingEntrance.executeNew = async () => failure;

    await assert.rejects(executeOfficialJump({ method: 'net', officialBaseUrl: BASE }, {}, subject.dependencies), {
        code: 'OFFICIAL_JUMP_RESULT_FAILURE'
    });

    assert.deepEqual(subject.logs, [{
        adapter: 'official-compat',
        method: 'net',
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        operationStage: 'jump-execution',
        targetHost: 'vendor.invalid',
        commonMethod: 'commonReturnStudentBaseInfo',
        code: 'OFFICIAL_JUMP_RESULT_FAILURE',
        operationName: 'IsGroupExisted',
        resultCode: 10010,
        resultSucc: false,
        resultMessage: '对不起，您无权调用此接口！ password=[REDACTED] token: [REDACTED]'
    }]);
    assert.doesNotMatch(JSON.stringify(subject.logs), /super-secret|hidden-token|SENSITIVE-TICKET/i);
});
