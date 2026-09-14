import assert from 'node:assert/strict';
import test from 'node:test';
import { executeWithOfficialRetry } from '../../server/utils/officialCompat/retryPolicy.js';

const expired = () => ({ code: 10011, succ: false, message: 'expired', data: null });

test('10011 retries the entire method and succeeds within three attempts', async () => {
    let calls = 0;
    const clears = [];
    const result = await executeWithOfficialRetry(async attempt => {
        calls += 1;
        return attempt < 3 ? expired() : 'official-ticket';
    }, {
        clearToken: attempt => clears.push(attempt)
    });

    assert.equal(calls, 3);
    assert.deepEqual(clears, [1, 2]);
    assert.deepEqual(result, {
        code: 10000,
        succ: true,
        message: '成功',
        data: 'official-ticket',
        raw: 'official-ticket'
    });
});

test('three consecutive 10011 results return null after three whole-method attempts', async () => {
    let calls = 0;
    let clears = 0;
    const result = await executeWithOfficialRetry(async () => {
        calls += 1;
        return expired();
    }, {
        clearToken: () => { clears += 1; }
    });

    assert.equal(calls, 3);
    assert.equal(clears, 3);
    assert.equal(result, null);
});

test('exceptions are not retried', async () => {
    let calls = 0;
    await assert.rejects(() => executeWithOfficialRetry(async () => {
        calls += 1;
        throw new Error('adapter failure');
    }), /adapter failure/);
    assert.equal(calls, 1);
});

