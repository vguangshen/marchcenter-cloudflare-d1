import {
    OfficialJumpConfigError,
    OfficialJumpNotImplementedError
} from './errors.js';
import { resolveOfficialInstance } from './instanceCatalog.js';

export const OFFICIAL_PLATFORM_SERVICES = Object.freeze({
    direct: 'jump',
    paasV2: 'PaasV2AgentAdapter',
    java: 'NewTrainingInterfaceUtilService',
    net: 'NetGeneralStandardInterfaceUtilService',
    marketing: 'ShichangyingxiaoshapanInterfaceUtilService',
    commerce: 'WangdianyunyingtuiguangGJshapanInterfaceUtilService',
    managementAccounting: 'GuanlikuaijiGJshapanInterfaceUtilService',
    crossBorderCommerce: 'KuajingdianshangshapanInterfaceUtilService',
    enterpriseManagement: 'QiyeguanlishapanInterfaceUtilService'
});

const FULL_INTERFACE_PATH = /\/(?:open|normwebservice\.asmx|login\.aspx|enterindex|tokeninfo|getusername|getloginteachername|trainingexampaper|trainingexampaperv2)(?:\/|$)/i;

function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function ownValue(primary, secondary, key, fallback) {
    if (hasOwn(primary, key)) return primary[key];
    if (hasOwn(secondary, key)) return secondary[key];
    return fallback;
}

export function resolveOfficialPlatform(method) {
    if (!Object.prototype.hasOwnProperty.call(OFFICIAL_PLATFORM_SERVICES, method)) {
        throw new OfficialJumpNotImplementedError(`official-compat 尚未实现平台: ${String(method)}`, {
            details: { method }
        });
    }
    return Object.freeze({ method, serviceName: OFFICIAL_PLATFORM_SERVICES[method] });
}

// Keep the fixed method/profile lookup in one place. Every public method has
// exactly one executable official profile.
export { resolveOfficialInstance };

/** Only the base URL form dynamically confirmed for the official adapters is accepted. */
export function validateConfirmedOfficialBaseUrl(value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialJumpConfigError('official-compat officialBaseUrl 不能为空', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch (cause) {
        throw new OfficialJumpConfigError('official-compat officialBaseUrl 格式无效', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED', cause
        });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new OfficialJumpConfigError('official-compat 只接受无内嵌凭据的 HTTP(S) base URL', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    if (value.endsWith('/') || parsed.search || parsed.hash || FULL_INTERFACE_PATH.test(parsed.pathname)) {
        throw new OfficialJumpConfigError(
            '尾斜杠、query、fragment、/open、WSDL 或完整接口路径不是已确认的 officialBaseUrl 输入',
            { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' }
        );
    }
    return value;
}

export function validateOfficialDirectUrl(value) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialJumpConfigError('直接跳转地址不能为空', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    let parsed;
    try { parsed = new URL(value); }
    catch (cause) {
        throw new OfficialJumpConfigError('直接跳转地址格式无效', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED', cause
        });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new OfficialJumpConfigError('直接跳转只接受无内嵌凭据的 HTTP(S) 地址', {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    return value;
}

function validateHttpUrlBase(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialJumpConfigError(`${label}不能为空`, {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    let parsed;
    try { parsed = new URL(value); }
    catch (cause) {
        throw new OfficialJumpConfigError(`${label}格式无效`, {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED', cause
        });
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new OfficialJumpConfigError(`${label}只接受无内嵌凭据的 HTTP(S) 地址`, {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    if (parsed.search || parsed.hash) {
        throw new OfficialJumpConfigError(`${label}不能携带 query 或 fragment`, {
            code: 'OFFICIAL_BASE_URL_UNSUPPORTED'
        });
    }
    return value;
}

export function validateOfficialPaasV2Address(value, label = 'paasV2 地址') {
    return validateHttpUrlBase(value, label);
}
export function validateOfficialBaseUrlConfirmation(config = {}) {
    if (config.officialBaseUrlConfirmed !== true) {
        throw new OfficialJumpConfigError('officialBaseUrl 必须由管理员明确确认', {
            code: 'OFFICIAL_BASE_URL_CONFIRMATION_REQUIRED'
        });
    }
    return true;
}

export function buildConfirmedJavaOpenBaseUrl(baseUrl) {
    return `${validateConfirmedOfficialBaseUrl(baseUrl)}/open`;
}

export function selectOfficialBaseUrl(config = {}, context = {}) {
    if (config.method === 'paasV2') {
        return config.apiBaseUrl || config.officialBaseUrl || (hasOwn(context, 'cardUrl') ? context.cardUrl : '');
    }
    return hasOwn(context, 'cardUrl') ? context.cardUrl : config.officialBaseUrl;
}

function currentIdentity(config, context) {
    const user = context.user && typeof context.user === 'object' ? context.user : {};
    const currentLoginName = ownValue(context, user, 'loginName',
        hasOwn(user, 'username') ? user.username : undefined);
    // Card execution is scoped to the signed-in MarchCenter user. Keep the
    // vendor naming contract for that request (mc{username}/mcs{username}N)
    // even when an old stored template still contains teacherUserName="teacher"
    // or className="默认班级". Explicit context values remain available for
    // local canary/adapter tests and other deliberate callers.
    const classOwner = user.classTeacherUsername !== undefined
        && user.classTeacherUsername !== null
        && user.classTeacherUsername !== ''
        ? user.classTeacherUsername
        : (hasOwn(user, 'username') ? user.username : currentLoginName);
    const generatedClassName = `${config.classPrefix ?? 'mc'}${classOwner}`;
    const generatedTeacherUserName = `${config.teacherPrefix ?? 'mc'}${classOwner}`;
    const hasMarchCenterIdentity = hasOwn(user, 'username') || hasOwn(user, 'loginName');
    const className = hasMarchCenterIdentity && !hasOwn(context, 'className')
        ? generatedClassName
        : ownValue(context, config, 'className', generatedClassName);
    const teacherUserName = hasMarchCenterIdentity && !hasOwn(context, 'teacherUserName')
        ? generatedTeacherUserName
        : ownValue(
        context,
        config,
        'teacherUserName',
        generatedTeacherUserName
    );
    const suffix = context.studentIndex !== undefined && context.studentIndex !== null
        ? context.studentIndex
        : (config.studentSuffix ?? '1');
    const studentLoginName = hasOwn(context, 'accountName')
        ? context.accountName
        : `${config.studentPrefix ?? 'mcs'}${currentLoginName}${suffix}`;
    const loginRole = ownValue(context, config, 'loginRole', 'student') === 'teacher'
        ? 'teacher'
        : 'student';
    const loginName = hasOwn(context, 'loginName')
        ? context.loginName
        : (loginRole === 'teacher' ? teacherUserName : studentLoginName);
    return { user, currentLoginName, className, teacherUserName, studentLoginName, loginRole, loginName };
}

export function mapMarchCenterToOfficialParameters(config = {}, context = {}, baseUrl) {
    const identity = currentIdentity(config, context);
    const userName = ownValue(
        context,
        config,
        'userName',
        hasOwn(identity.user, 'name')
            ? identity.user.name
            : (hasOwn(identity.user, 'nickname') ? identity.user.nickname : identity.currentLoginName)
    );
    const studentList = ownValue(
        context,
        config,
        'studentList',
        identity.loginRole === 'teacher' ? [identity.studentLoginName] : undefined
    );
    const sixParameterSandbox = ['marketing', 'commerce', 'managementAccounting', 'enterpriseManagement']
        .includes(config.method);
    const mappedMaxRunYear = ownValue(context, config, 'maxRunYear', sixParameterSandbox ? 0 : undefined);
    const mappedAutoDeal = ownValue(context, config, 'autoDeal', sixParameterSandbox ? false : undefined);
    return Object.freeze({
        loginName: identity.loginName,
        className: identity.className,
        teacherUserName: identity.teacherUserName,
        startTime: ownValue(context, config, 'startTime', undefined),
        endTime: ownValue(context, config, 'endTime', undefined),
        flag: ownValue(context, config, 'flag', undefined),
        trainOrExam: ownValue(context, config, 'trainOrExam', undefined),
        userId: hasOwn(context, 'userId')
            ? context.userId
            : (hasOwn(identity.user, 'id') ? identity.user.id : config.userId),
        userName,
        startExam: ownValue(context, config, 'startExam', undefined),
        classType: ownValue(context, config, 'classType', undefined),
        maxRunYear: mappedMaxRunYear,
        autoDeal: mappedAutoDeal,
        roleName: ownValue(context, config, 'roleName', undefined),
        teamName: ownValue(context, config, 'teamName', undefined),
        studentList,
        currentLoginName: identity.currentLoginName,
        softwareUnique: ownValue(context, config, 'softwareUnique', config.productModuleId || ''),
        productId: ownValue(context, config, 'productId', config.productId),
        productModuleId: ownValue(context, config, 'productModuleId', config.productModuleId),
        plugFlag: ownValue(context, config, 'plugFlag', config.plugFlag),
        answerType: ownValue(context, config, 'answerType', config.answerType),
        returnUrl: ownValue(context, config, 'returnUrl', config.returnUrl),
        baseUrl
    });
}

export function selectOfficialCommonMethod(config = {}, context = {}) {
    const loginRole = ownValue(context, config, 'loginRole', 'student');
    return loginRole === 'teacher'
        ? 'commonReturnTeacherBaseInfo'
        : 'commonReturnStudentBaseInfo';
}

