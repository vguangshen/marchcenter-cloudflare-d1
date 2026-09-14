import { createOfficialDependencyFactory } from './officialCompat/officialDependencyFactory.js';
import { executeOfficialJump, planOfficialJump } from './officialCompat/officialJumpExecutor.js';
import { selectOfficialBaseUrl } from './officialCompat/officialJumpConfig.js';
import { preflightOfficialPlatform } from './officialCompat/officialJumpPreflight.js';
import { deleteOfficialStudent } from './officialCompat/officialStudentLifecycle.js';
import { deleteOfficialClass } from './officialCompat/officialClassLifecycle.js';
import { initializeOfficialModule } from './officialCompat/officialModuleLifecycle.js';
import { validateOfficialTransportAddress } from './officialCompat/cardAddress.js';

// Platform-wide initialization can legitimately take much longer than login,
// account lookup and other ordinary official API calls.
export const DEFAULT_MODULE_INIT_TIMEOUT_MS = 120_000;

function officialDependencies(config, context, dependencies) {
    if (dependencies.officialDependencies) return dependencies.officialDependencies;
    return createOfficialDependencyFactory({
        ...(dependencies.official || {}),
        baseUrl: selectOfficialBaseUrl(config, context),
        allowHttp: config.allowHttp === true,
        ...(dependencies.officialTokenStore ? { tokenStore: dependencies.officialTokenStore } : {})
    });
}

function defaultUrlValidator(config, context) {
    return validateOfficialTransportAddress(config, context);
}

/** Single production entry: every supported platform uses the official adapter. */
export async function executePlatformJump(config, context = {}, dependencies = {}) {
    const resolvedDependencies = officialDependencies(config, context, dependencies);
    await preflightOfficialPlatform(config, context, {
        urlValidator: dependencies.urlValidator || defaultUrlValidator,
        credentialsProvider: resolvedDependencies.credentialsProvider
    });
    const executor = dependencies.officialExecutor || executeOfficialJump;
    return executor(config, context, resolvedDependencies);
}

/** Read-only official preflight. */
export async function preflightPlatformJump(config, context = {}, dependencies = {}) {
    const resolvedDependencies = officialDependencies(config, context, dependencies);
    return preflightOfficialPlatform(config, context, {
        urlValidator: dependencies.urlValidator || defaultUrlValidator,
        credentialsProvider: resolvedDependencies.credentialsProvider
    });
}

/** Pure official plan: no credentials, network calls or side effects. */
export function planPlatformJump(config, context = {}) {
    return planOfficialJump(config, context);
}

/** Official student deletion; no fallback or alternate executor exists. */
export async function deletePlatformStudent(config, context, accountName, dependencies = {}) {
    const resolvedDependencies = officialDependencies(config, context, dependencies);
    await (dependencies.urlValidator || defaultUrlValidator)(config, context);
    const remove = dependencies.officialDelete || deleteOfficialStudent;
    return remove(config, context, accountName, resolvedDependencies);
}

/**
 * Official remote class deletion (SOAP/Java open-API path). JAVA platforms are
 * routed to the account-management API direct DB delete in the sso route and no
 * longer reach this adapter path. SOAP: IsGroupExisted + DelGroup。
 */
export async function deletePlatformClass(config, context, target, dependencies = {}) {
    const resolvedDependencies = officialDependencies(config, context, dependencies);
    await (dependencies.urlValidator || defaultUrlValidator)(config, context);
    const remove = dependencies.officialClassDelete || deleteOfficialClass;
    return remove(config, context, target, resolvedDependencies);
}

/** Official module initialization (JAVA-only). */
export async function initializePlatformModule(config, context, dependencies = {}) {
    const resolvedDependencies = officialDependencies(config, context, {
        ...dependencies,
        official: {
            ...(dependencies.official || {}),
            timeoutMs: dependencies.moduleInitTimeoutMs ?? DEFAULT_MODULE_INIT_TIMEOUT_MS
        }
    });
    await (dependencies.urlValidator || defaultUrlValidator)(config, context);
    const init = dependencies.officialModuleInit || initializeOfficialModule;
    return init(config, context, resolvedDependencies);
}
