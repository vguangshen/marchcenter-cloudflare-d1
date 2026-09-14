import { createOfficialAdapter } from './adapterRegistry.js';
import { OfficialJumpExecutionError } from './errors.js';
import {
    resolveOfficialPlatform,
    selectOfficialBaseUrl,
    validateConfirmedOfficialBaseUrl
} from './officialJumpConfig.js';

const SUCCESS = 10000;
const TOKEN_INVALID = 10011;
const MAX_TOKEN_ATTEMPTS = 3;

/**
 * Remote class deletion. SOAP platforms resolve the group ID via
 * IsGroupExisted and call DelGroup. JAVA platforms delete classes through the
 * account-management API (direct DB delete) instead of the open APIs, which are
 * unreliable on real deployments. Direct URL passthrough has no class
 * lifecycle operation.
 */
export async function deleteOfficialClass(config, context, target, dependencies) {
    const { method, serviceName } = resolveOfficialPlatform(config.method);
    if (method === 'direct') {
        throw new OfficialJumpExecutionError('直接跳转不支持远端班级删除', {
            code: 'OFFICIAL_CLASS_DELETE_UNSUPPORTED'
        });
    }
    const baseUrl = validateConfirmedOfficialBaseUrl(selectOfficialBaseUrl(config, context));
    const credentials = await dependencies.credentialsProvider.getCredentials({ method, config });
    const className = typeof target === 'string' ? target : target?.className;
    const teacherUserName = typeof target === 'string' ? undefined : target?.teacherUserName;
    const studentAccountList = typeof target === 'string' ? [] : target?.studentAccountList;
    const adapter = createOfficialAdapter(serviceName, {
        baseUrl,
        fetchImplementation: dependencies.fetchImplementation,
        tokenStore: dependencies.tokenStore,
        credentials,
        timeoutMs: dependencies.timeoutMs,
        maxResponseBytes: dependencies.maxResponseBytes
    });
    if (typeof adapter.deleteClassAccount !== 'function') {
        throw new OfficialJumpExecutionError('当前 official 适配器未实现班级删除', {
            code: 'OFFICIAL_CLASS_DELETE_UNSUPPORTED'
        });
    }

    for (let attempt = 1; attempt <= MAX_TOKEN_ATTEMPTS; attempt += 1) {
        const outcome = await adapter.deleteClassAccount({ className, teacherUserName, studentAccountList });
        if (outcome.deleted === false && outcome.result == null) {
            return Object.freeze({ deleted: false, className, groupID: null });
        }
        if (Number(outcome.result?.code) === TOKEN_INVALID && method === 'java') {
            dependencies.tokenStore.delete(`${baseUrl}/open`);
            continue;
        }
        if (!outcome.result || Number(outcome.result.code) !== SUCCESS || outcome.result.succ !== true) {
            const error = new OfficialJumpExecutionError(
                `远程班级删除失败（平台返回 code ${outcome.result?.code ?? 'unknown'}）`,
                {
                    code: 'OFFICIAL_CLASS_DELETE_FAILED',
                    details: {
                        method,
                        serviceName,
                        className,
                        resultCode: outcome.result?.code ?? null
                    }
                }
            );
            error.status = 502;
            throw error;
        }
        return Object.freeze({
            deleted: true,
            className,
            groupID: outcome.groupID ?? null
        });
    }
    const error = new OfficialJumpExecutionError('远程班级删除连续三次返回 Token 失效', {
        code: 'OFFICIAL_CLASS_DELETE_TOKEN_EXHAUSTED'
    });
    error.status = 502;
    throw error;
}
