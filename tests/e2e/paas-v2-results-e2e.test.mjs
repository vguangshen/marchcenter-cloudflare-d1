import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { createProductionHarness } from './helpers/productionHarness.mjs';

const success = data => ({ code: '10000', data });

test('agent task scores refresh, persist per user and clear after reset', async () => {
    const harness = await createProductionHarness({ officialTokenCacheScope: 'isolate' });
    try {
        const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
        const pem = publicKey.export({ type: 'spki', format: 'pem' });
        const apiBaseUrl = 'https://localhost:9289/agent-results';
        const jumpBaseUrl = `${apiBaseUrl}/enter`;
        const config = {
            method: 'paasV2', apiBaseUrl, jumpBaseUrl, externalPublicKey: pem, publicKey: pem,
            productId: 'E2E', softwareUnique: 'agent-fixture', plugFlag: 'fixture-task', answerType: '1'
        };
        const configId = await harness.seedConfig(config);
        const competitionId = await harness.seedCompetition({
            configId, method: 'paasV2', url: jumpBaseUrl
        });
        await harness.run(
            'UPDATE competitions SET paas_v2_plug_flag = ?, paas_v2_answer_type = ?, paas_v2_software_unique = ? WHERE id = ?',
            config.plugFlag, config.answerType, config.softwareUnique, competitionId
        );
        await harness.seedConfig({ ...config, apiBaseUrl: 'https://localhost:9289/unrelated' });

        const other = { id: 2, username: 'fixture-other', role: 'student' };
        await harness.seedUser(other);
        await harness.run('INSERT INTO user_access_policies (user_id, configured) VALUES (?, 1)', other.id);
        const otherHeaders = { Authorization: `Bearer ${await harness.issueToken(other)}` };
        const query = (headers = {}) => harness.api('/api/paas-v2/result', { body: { competitionId }, headers });
        const listResult = async (headers = {}) => {
            const response = await harness.api('/api/competitions', { headers });
            assert.equal(response.status, 200, response.text);
            return response.data.find(card => card.id === competitionId).agentResult;
        };

        const denied = await query(otherHeaders);
        assert.equal(denied.status, 403);
        assert.equal(harness.platform.state.requests.length, 0);
        await harness.run('INSERT INTO user_permissions (user_id, competition_id) VALUES (?, ?)', other.id, competitionId);

        harness.platform.queueJava('GetTokenInfo', [success('mock-token'), success('mock-reset-token'), success('mock-reset-retry-token')]);
        harness.platform.queueJava('GetTaskState', [
            success({ finish: 3 }),
            success(JSON.stringify({ finish: 1 })),
            { code: '50000', message: 'mock-error-body' },
            success({ finish: 1 })
        ]);
        harness.platform.queueJava('GetTrainingScore', [
            success({ objScore: '70.25', subScore: 11.5 }),
            success({ objScore: 0, subScore: 0 })
        ]);
        harness.platform.queueJava('ResetTaskData', [{ code: '50000' }, success(null)]);

        const launch = await harness.api('/api/sso/execute', { body: { competitionId } });
        assert.equal(launch.status, 200, launch.text);
        assert.equal(launch.data.postForm.action, jumpBaseUrl);
        assert.equal(harness.platform.state.requests[0].path, '/agent-results/GetTokenInfo');

        const pending = await query();
        assert.equal(pending.status, 200, pending.text);
        assert.match(pending.response.headers.get('cache-control') || '', /no-store/);
        assert.deepEqual(pending.data, { status: 'scoring', score: null });
        assert.deepEqual(await listResult(), pending.data);
        assert.equal(await listResult(otherHeaders), null);

        const completed = await query();
        assert.deepEqual(completed.data, { status: 'completed', score: 81.75 });
        assert.deepEqual(await listResult(), completed.data);
        const failure = await query();
        assert.equal(failure.status, 502);
        assert.doesNotMatch(failure.text, /mock-error-body/);
        assert.deepEqual(await listResult(), completed.data);

        const zero = await query();
        assert.deepEqual(zero.data, { status: 'completed', score: 0 });
        assert.deepEqual(await listResult(), zero.data);

        const resetTask = () => harness.api('/api/paas-v2/reset', { body: { competitionId } });
        const unsuccessfulReset = await resetTask();
        assert.ok(unsuccessfulReset.status >= 400);
        assert.deepEqual(await listResult(), zero.data);
        const reset = await resetTask();
        assert.equal(reset.status, 200, reset.text);
        assert.equal(await listResult(), null);
        assert.deepEqual(
            harness.platform.state.requests.map(request => request.operationName),
            ['GetTokenInfo', 'GetTaskState', 'GetTaskState', 'GetTrainingScore', 'GetTaskState',
                'GetTaskState', 'GetTrainingScore', 'GetTokenInfo', 'ResetTaskData', 'GetTokenInfo', 'ResetTaskData']
        );
    } finally {
        await harness.dispose();
    }
});
