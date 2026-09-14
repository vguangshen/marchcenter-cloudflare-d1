import { validateCanarySpecification } from './canaryGate.js';

function stableFingerprintPayload(input) {
    const specification = validateCanarySpecification(input, { requireConfirmation: false });
    return Object.freeze({
        configId: specification.configId,
        method: specification.method,
        officialBaseUrl: specification.officialBaseUrl,
        hostname: specification.allowedHostname,
        port: specification.allowedPort,
        contextPath: specification.allowedContextPath,
        approvedResolvedAddresses: [...specification.approvedResolvedAddresses].sort(),
        privateTargetExplicitlyApproved: specification.privateTargetExplicitlyApproved === true,
        testStudentAccount: specification.testStudentAccount,
        testTeacherAccount: specification.testTeacherAccount,
        testStudentList: [...specification.testStudentList],
        testClassName: specification.testClassName,
        testUserId: specification.testUserId,
        classType: specification.classType,
        trainOrExam: specification.trainOrExam,
        credentialsConfigured: specification.credentialsConfigured === true,
        isolatedTestEnvironmentConfirmed: specification.isolatedTestEnvironmentConfirmed === true,
        snapshotOrCleanupReady: specification.snapshotOrCleanupReady === true
    });
}

function bytesToHex(value) {
    return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintCanaryPlan(input) {
    const payload = stableFingerprintPayload(input);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    return bytesToHex(digest);
}

export { stableFingerprintPayload };

