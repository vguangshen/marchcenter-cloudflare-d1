import test from 'node:test';
import assert from 'node:assert/strict';
import { applySelectedTimeRules, clearSelectedTimeRules, getPermissionCounts, incrementPermissionTime } from '../../src/utils/permissionTime.js';

test('批量时间只改已选模块，空时间字段保留原值和其他规则', () => {
    const original = {
        1: { unlockTime: '2026-10-01T09:00', lockTime: '2026-10-10T18:00', marker: 'keep' },
        2: { lockTime: '2026-12-31T18:00' },
        3: { unlockTime: '2026-10-02T09:00' }
    };
    const result = applySelectedTimeRules(original, [1, 3, 4], { unlockTime: '2026-11-01T10:00', lockTime: '' });
    assert.deepEqual(result[1], { unlockTime: '2026-11-01T10:00', lockTime: '2026-10-10T18:00', marker: 'keep' });
    assert.deepEqual(result[2], original[2]);
    assert.deepEqual(result[3], { unlockTime: '2026-11-01T10:00' });
    assert.deepEqual(result[4], { unlockTime: '2026-11-01T10:00' });
    assert.equal(original[1].unlockTime, '2026-10-01T09:00');
    assert.equal(applySelectedTimeRules(original, [1], { unlockTime: '', lockTime: '' }), original);
});

test('清空已选模块时间会恢复跟随全局，保留未选模块及非时间规则', () => {
    const original = { 1: { unlockTime: '2026-10-01T09:00', lockTime: '2026-11-01T18:00' }, 2: { lockTime: '2026-12-31T18:00' }, 3: { unlockTime: '2026-10-02T09:00', marker: true } };
    const result = clearSelectedTimeRules(original, [1, 3, 4]);
    assert.equal(Object.hasOwn(result, 1), false);
    assert.deepEqual(result[2], original[2]);
    assert.deepEqual(result[3], { marker: true });
    assert.equal(Object.hasOwn(result, 4), false);
    assert.equal(original[1].unlockTime, '2026-10-01T09:00');
});

test('平台与智能体分别计数且兼容由 API 返回的字符串 ID', () => {
    const links = [{ id: 1 }, { id: 2, ssoMethod: 'java' }, { id: 3, ssoMethod: 'paasV2' }, { id: 4, ssoMethod: 'paasV2' }];
    assert.deepEqual(getPermissionCounts(links, ['1', 3, 999]), { totalPlatform: 2, selectedPlatform: 1, totalAgent: 2, selectedAgent: 1 });
    assert.deepEqual(getPermissionCounts(null, null), { totalPlatform: 0, selectedPlatform: 0, totalAgent: 0, selectedAgent: 0 });
});

test('固定时长按本地日历增加，正确跨月、跨年和闰年', () => {
    assert.equal(incrementPermissionTime('2026-10-28T23:30'), '2026-10-29T00:30');
    assert.equal(incrementPermissionTime('2026-01-30T12:30', 2, 'days'), '2026-02-01T12:30');
    assert.equal(incrementPermissionTime('2026-12-31T12:30', 1, 'days'), '2027-01-01T12:30');
    assert.equal(incrementPermissionTime('2028-02-28T12:30', 1, 'days'), '2028-02-29T12:30');
});
