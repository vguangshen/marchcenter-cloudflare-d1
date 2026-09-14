import { createOfficialTokenStore } from '../../../server/utils/officialCompat/tokenStore.js';
import { createNewTrainingAdapter } from '../../../server/utils/officialCompat/java/newTrainingAdapter.js';

export const TEST_CREDENTIALS = Object.freeze({ tokenNum: 'INTERFACE-TEST', password: 'local-test-password' });

export function result(code, data, message = code === 10000 ? '成功' : '失败') {
    return JSON.stringify({ code, succ: code === 10000, message, data });
}

export function studentParameters(overrides = {}) {
    return {
        loginName: 'student local', className: '班级 & A', teacherUserName: 'teacher+one',
        startTime: '1', endTime: '2', flag: 'train flag', trainOrExam: 'train',
        userId: '9223372036854775807', userName: '学生', startExam: false, classType: 2,
        maxRunYear: 0, autoDeal: false, roleName: '角色/一', teamName: 'team=1',
        ...overrides
    };
}

export function teacherParameters(overrides = {}) {
    return {
        loginName: 'teacher local', className: '班级 & A', userId: '1', userName: '教师',
        startTime: '1', endTime: '2', startExam: false, classType: 3,
        studentList: ['student a', '学生+b'], maxRunYear: 0, autoDeal: false,
        roleName: '角色/一', teamName: 'team=1', ...overrides
    };
}

export function createFetchPlan(plan) {
    const calls = [];
    const queues = new Map(Object.entries(plan).map(([path, responses]) => [path, [...responses]]));
    const fetchImplementation = async (url, options) => {
        const parsed = new URL(url);
        const queue = queues.get(parsed.pathname);
        if (!queue?.length) throw new Error(`unplanned request ${parsed.pathname}`);
        const next = queue.shift();
        const call = {
            url: String(url), path: parsed.pathname, method: options.method,
            headers: { ...options.headers }, body: options.body
        };
        calls.push(call);
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next(call);
        const status = next.status ?? 200;
        return new Response(next.body ?? '', { status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchImplementation };
}

export function adapterWithPlan(plan, options = {}) {
    const mock = createFetchPlan(plan);
    const tokenStore = options.tokenStore || createOfficialTokenStore(options.storeOptions);
    const adapter = createNewTrainingAdapter({
        baseUrl: options.baseUrl || 'https://local.invalid',
        credentials: TEST_CREDENTIALS,
        tokenStore,
        fetchImplementation: mock.fetchImplementation,
        timeoutMs: options.timeoutMs || 1000
    });
    return { ...mock, tokenStore, adapter };
}

export const tokenSuccess = token => ({ body: result(10000, token) });
export const ok = data => ({ body: result(10000, data) });
export const failure = (code, message = '失败') => ({ body: result(code, null, message) });
