import { createOfficialAdapter } from './adapterRegistry.js';
import { OfficialJumpExecutionError } from './errors.js';
import {
    resolveOfficialPlatform,
    selectOfficialBaseUrl,
    validateConfirmedOfficialBaseUrl
} from './officialJumpConfig.js';

const TOKEN_INVALID = 10011;
const SUCCESS = 10000;
const MAX_TOKEN_ATTEMPTS = 3;

/** Separate lifecycle capability; it intentionally does not expose an official common* method. */
export async function deleteOfficialStudent(config, context, accountName, dependencies) {
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    if (method === 'direct') {
        throw new OfficialJumpExecutionError('直接跳转不支持远端学生删除', {
            code: 'OFFICIAL_STUDENT_DELETE_UNSUPPORTED'
        });
    }
    const baseUrl = validateConfirmedOfficialBaseUrl(selectOfficialBaseUrl(config, context));
    const credentials = await dependencies.credentialsProvider.getCredentials({ method, config });
    const adapter = createOfficialAdapter(serviceName, {
        baseUrl,
        fetchImplementation: dependencies.fetchImplementation,
        tokenStore: dependencies.tokenStore,
        credentials,
        timeoutMs: dependencies.timeoutMs,
        maxResponseBytes: dependencies.maxResponseBytes
    });
    if (typeof adapter.deleteStudentAccount !== 'function') {
        throw new OfficialJumpExecutionError('当前 official 适配器未实现学生删除', {
            code: 'OFFICIAL_STUDENT_DELETE_UNSUPPORTED'
        });
    }

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
        const result = await adapter.deleteStudentAccount({ loginName: accountName });
        if (Number(result?.code) === TOKEN_INVALID && method === 'java') {
            dependencies.tokenStore.delete(`${baseUrl}/open`);
            continue;
        }
        if (Number(result?.code) !== SUCCESS || result?.succ !== true) {
            throw new OfficialJumpExecutionError('远程学生删除失败', {
                code: 'OFFICIAL_STUDENT_DELETE_FAILED',
                details: { method, serviceName, resultCode: result?.code ?? null }
            });
        }
        return Object.freeze({
            accountName,
            operation: method === 'java' ? 'delStudentDataQueue' : 'MarkStuDeleted'
        });
    }
    throw new OfficialJumpExecutionError('远程学生删除连续三次返回 Token 失效', {
        code: 'OFFICIAL_STUDENT_DELETE_TOKEN_EXHAUSTED'
    });
}
