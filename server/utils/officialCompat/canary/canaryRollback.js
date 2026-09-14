import { validateCanarySpecification } from './canaryGate.js';

export function buildCanaryRollbackPlan(input) {
    const specification = validateCanarySpecification(input, { requireConfirmation: false });
    return Object.freeze({
        configId: specification.configId,
        automaticActions: Object.freeze([]),
        marchCenter: Object.freeze([
            Object.freeze({ action: 'disable-test-config', configId: specification.configId }),
            Object.freeze({ action: 'retain-official-base-url-by-default', configId: specification.configId }),
            Object.freeze({ action: 'review-local-ready-state', configId: specification.configId })
        ]),
        remoteManualChecks: Object.freeze([
            `班级: ${specification.testClassName}`,
            `学生: ${specification.testStudentAccount}`,
            `教师: ${specification.testTeacherAccount}`,
            '重复班级或账号记录',
            '测试 Token 或缓存'
        ]),
        warning: '本计划只生成清单，不执行数据库更新或远端删除。'
    });
}
