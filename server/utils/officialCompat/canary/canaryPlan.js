import { planOfficialJump } from '../officialJumpExecutor.js';
import { validateCanarySpecification } from './canaryGate.js';
import { validateApprovedAddresses } from './targetPolicy.js';
import { fingerprintCanaryPlan } from './planFingerprint.js';

function maskAccount(value) {
    const text = String(value || '');
    if (text.length <= 2) return '*'.repeat(text.length);
    return `${text[0]}***${text.at(-1)}`;
}

export async function createOfficialCanaryPlan(input) {
    const specification = validateCanarySpecification(input, { requireConfirmation: false });
    validateApprovedAddresses(specification);
    const context = {
        loginRole: input.loginRole === 'teacher' ? 'teacher' : 'student',
        loginName: input.loginRole === 'teacher'
            ? specification.testTeacherAccount
            : specification.testStudentAccount,
        className: specification.testClassName,
        teacherUserName: specification.testTeacherAccount,
        studentList: specification.testStudentList,
        userId: specification.testUserId,
        userName: input.testUserName ?? specification.testStudentAccount,
        classType: specification.classType,
        trainOrExam: specification.trainOrExam,
        startTime: input.startTime,
        endTime: input.endTime,
        flag: input.flag,
        startExam: input.startExam,
        maxRunYear: input.maxRunYear,
        autoDeal: input.autoDeal,
        roleName: input.roleName,
        teamName: input.teamName
    };
    const official = planOfficialJump({
        method: specification.method,
        officialBaseUrl: specification.officialBaseUrl,
        cardUrl: specification.cardUrl
    }, context);
    const target = new URL(specification.officialBaseUrl);
    const fingerprint = await fingerprintCanaryPlan(specification);
    return Object.freeze({
        configId: specification.configId,
        method: specification.method,
        serviceName: official.serviceName,
        target: Object.freeze({
            hostname: specification.allowedHostname,
            port: specification.allowedPort,
            path: target.pathname
        }),
        userRole: context.loginRole,
        loginName: maskAccount(context.loginName),
        className: specification.testClassName,
        classType: specification.classType,
        trainOrExam: specification.trainOrExam,
        expectedSteps: official.expectedSteps,
        mayCreateClass: true,
        mayCreateAccount: true,
        finalUrlRule: official.urlRule,
        fingerprint,
        rollback: Object.freeze([
            `仅禁用测试配置 ${specification.configId}`,
            '默认保留 officialBaseUrl，除非人工选择清除',
            '仅人工检查并清理本次测试班级、学生、教师、重复记录和本地就绪状态'
        ])
    });
}
