import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrainingEntrance } from '../../../server/utils/officialCompat/trainingEntrance.js';
import { createOfficialTokenStore } from '../../../server/utils/officialCompat/tokenStore.js';
import { createFetchPlan, failure, ok, studentParameters, TEST_CREDENTIALS, tokenSuccess } from './helpers.mjs';

test('10011 clears token and reruns the whole student method', async () => {
    const mock = createFetchPlan({
        '/open/tokenInfo': [tokenSuccess('T1'), tokenSuccess('T2')], '/open/getUserName': [ok('r1'), ok('r2')],
        '/open/trainingExamPaper': [failure(10011, 'expired'), ok('ticket-2')]
    });
    const store = createOfficialTokenStore(); const entrance = createTrainingEntrance();
    const output = await entrance.executeNew({
        serviceName: 'NewTrainingInterfaceUtilService', methodName: 'CommonReturnStudentBaseInfo',
        parameters: studentParameters(), url: 'https://local.invalid',
        adapterOptions: { tokenStore: store, credentials: TEST_CREDENTIALS, fetchImplementation: mock.fetchImplementation }
    });
    assert.equal(output.data, 'u=ticket-2');
    assert.deepEqual(mock.calls.map(call => call.path), [
        '/open/tokenInfo', '/open/getUserName', '/open/trainingExamPaper',
        '/open/tokenInfo', '/open/getUserName', '/open/trainingExamPaper'
    ]);
});

test('three 10011 returns null; ordinary exception is not retried', async () => {
    const mock = createFetchPlan({
        '/open/tokenInfo': [tokenSuccess('T1'), tokenSuccess('T2'), tokenSuccess('T3')],
        '/open/getUserName': [ok('r1'), ok('r2'), ok('r3')],
        '/open/trainingExamPaper': [failure(10011), failure(10011), failure(10011)]
    });
    const entrance = createTrainingEntrance();
    const output = await entrance.executeNew({
        serviceName: 'NewTrainingInterfaceUtilService', methodName: 'commonReturnStudentBaseInfo', parameters: studentParameters(),
        url: 'https://local.invalid', adapterOptions: { tokenStore: createOfficialTokenStore(), credentials: TEST_CREDENTIALS, fetchImplementation: mock.fetchImplementation }
    });
    assert.equal(output, null); assert.equal(mock.calls.filter(call => call.path.endsWith('trainingExamPaper')).length, 3);

    const broken = createFetchPlan({ '/open/tokenInfo': [tokenSuccess('T')], '/open/getUserName': [{ body: '' }] });
    await assert.rejects(entrance.executeNew({
        serviceName: 'NewTrainingInterfaceUtilService', methodName: 'commonReturnStudentBaseInfo', parameters: studentParameters(),
        url: 'https://local.invalid', adapterOptions: { tokenStore: createOfficialTokenStore(), credentials: TEST_CREDENTIALS, fetchImplementation: broken.fetchImplementation }
    }));
    assert.equal(broken.calls.length, 2);
});
