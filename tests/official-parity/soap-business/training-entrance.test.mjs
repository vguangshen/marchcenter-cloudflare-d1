import assert from 'node:assert/strict';
import test from 'node:test';
import { OfficialAdapterMethodError } from '../../../server/utils/officialCompat/errors.js';
import { createTrainingEntrance, lowerCaseInitial } from '../../../server/utils/officialCompat/trainingEntrance.js';

test('executeNew selects service, lowercases only the first method character and wraps non-Result', async () => {
    const invocations = [];
    const entrance = createTrainingEntrance({
        adapterFactory(serviceName, options) {
            invocations.push({ serviceName, options });
            return {
                commonReturnTargetId(parameters) {
                    assert.deepEqual(parameters, { loginName: '学生甲' });
                    return parameters.loginName;
                }
            };
        }
    });
    const result = await entrance.executeNew({
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        methodName: 'CommonReturnTargetId',
        parameters: { loginName: '学生甲', ignored: 'not-forwarded' },
        url: 'http://mock.invalid'
    });
    assert.deepEqual(result, {
        code: 10000,
        succ: true,
        message: '成功',
        data: '学生甲',
        raw: '学生甲'
    });
    assert.equal(invocations[0].serviceName, 'NetGeneralStandardInterfaceUtilService');
    assert.equal(invocations[0].options.baseUrl, 'http://mock.invalid');
    assert.equal(lowerCaseInitial('X'), 'x');
});

test('10011 clears url/open and retries the whole common method up to three times', async () => {
    let invocations = 0;
    const clears = [];
    const entrance = createTrainingEntrance({
        adapterFactory() {
            return {
                commonCheckTrain() {
                    invocations += 1;
                    return { code: 10011, succ: false, message: 'token expired', data: null };
                }
            };
        },
        clearToken(event) {
            clears.push(event);
        }
    });
    const result = await entrance.executeNew({
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        methodName: 'commonCheckTrain',
        parameters: {},
        url: 'http://mock.invalid'
    });
    assert.equal(result, null);
    assert.equal(invocations, 3);
    assert.deepEqual(clears.map(event => event.key), [
        'http://mock.invalid/open', 'http://mock.invalid/open', 'http://mock.invalid/open'
    ]);
    assert.deepEqual(clears.map(event => event.attempt), [1, 2, 3]);
});

test('ordinary exceptions are not retried and do not clear tokens', async () => {
    let invocations = 0;
    let clears = 0;
    const expected = new Error('ordinary failure');
    const entrance = createTrainingEntrance({
        adapterFactory() {
            return {
                commonCheckTrain() {
                    invocations += 1;
                    throw expected;
                }
            };
        },
        clearToken() { clears += 1; }
    });
    await assert.rejects(entrance.executeNew({
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        methodName: 'commonCheckTrain',
        parameters: {},
        url: 'http://mock.invalid'
    }), error => error === expected);
    assert.equal(invocations, 1);
    assert.equal(clears, 0);
});

test('arbitrary and registered-but-unimplemented methods are rejected explicitly', async () => {
    const entrance = createTrainingEntrance({ adapterFactory: () => ({}) });
    await assert.rejects(entrance.executeNew({
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        methodName: 'constructor',
        parameters: {},
        url: 'http://mock.invalid'
    }), error => error instanceof OfficialAdapterMethodError
        && error.code === 'OFFICIAL_ADAPTER_METHOD_NOT_ALLOWED');
    await assert.rejects(entrance.executeNew({
        serviceName: 'NetGeneralStandardInterfaceUtilService',
        methodName: 'CommonGetExamPaperScore',
        parameters: {},
        url: 'http://mock.invalid'
    }), error => error instanceof OfficialAdapterMethodError
        && error.code === 'OFFICIAL_ADAPTER_METHOD_NOT_IMPLEMENTED');
});

test('unknown services are rejected by the fixed registry', async () => {
    const entrance = createTrainingEntrance();
    await assert.rejects(entrance.executeNew({
        serviceName: 'ArbitraryService',
        methodName: 'commonReturnTargetId',
        parameters: { loginName: 'x' },
        url: 'http://mock.invalid'
    }), error => error instanceof OfficialAdapterMethodError
        && error.code === 'OFFICIAL_ADAPTER_SERVICE_NOT_ALLOWED');
});
