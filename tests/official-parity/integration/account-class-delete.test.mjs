import assert from 'node:assert/strict';
import test from 'node:test';
import {
    deletePlatformClass,
    isClassDeleteMappingReady,
    normalizeAccountManagementConfig,
    normalizeClassDeleteMapping
} from '../../../server/utils/accountManagementApi.js';

const MAPPING = {
    enabled: true,
    apiId: 'svc',
    databaseName: 'cloud_training',
    classTable: 'user_class',
    classNameColumn: 'uc_name',
    classIdColumn: 'id',
    userTable: 'user_info',
    userClassColumn: 'class_id'
};

function executorConfig(overrides = {}) {
    return normalizeAccountManagementConfig({
        id: 'svc', name: 'executor', enabled: true,
        endpointUrl: 'http://executor.invalid', authMode: 'hmac',
        signingSecret: 'test-hmac-secret', ...overrides
    });
}

function stubFetch(jsonBody, status = 200) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method, headers: { ...options.headers }, body: options.body });
        return new Response(JSON.stringify(jsonBody), {
            status,
            headers: { 'Content-Type': 'application/json' }
        });
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

test('normalizeClassDeleteMapping keeps required class/account relation fields', () => {
    const normalized = normalizeClassDeleteMapping({
        enabled: true, system: 'java', databaseName: 'db', classTable: 'user_class',
        classNameColumn: 'uc_name', classIdColumn: 'id', userTable: 'user', userClassColumn: 'class_id',
        ownerTable: 'dropped',
        childTables: Array.from({ length: 25 }, (_, i) => ({ table: `t${i}`, classIdColumn: 'class_id' }))
    });
    assert.equal(normalized.databaseName, 'db');
    assert.equal(normalized.classTable, 'user_class');
    assert.equal(normalized.classNameColumn, 'uc_name');
    assert.equal(normalized.classIdColumn, 'id', '班级ID列保留');
    assert.equal(normalized.userTable, 'user', '用户表保留');
    assert.equal(normalized.userClassColumn, 'class_id', '用户班级列保留');
    assert.equal(normalized.apiId, '');
    assert.equal(normalized.enabled, true, '启用开关保留');
    assert.equal(normalized.childTables, undefined, '级联子表已移除');
    assert.equal(normalized.system, undefined, '平台类型已移除（由 JAVA SSO 隐含）');
});

test('isClassDeleteMappingReady requires class and account cascade mapping', () => {
    assert.equal(isClassDeleteMappingReady(MAPPING), true);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, enabled: false }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, apiId: '' }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, classTable: '' }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, databaseName: '' }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, classIdColumn: '' }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, userTable: '' }), false);
    assert.equal(isClassDeleteMappingReady({ ...MAPPING, userClassColumn: '' }), false);
    assert.equal(isClassDeleteMappingReady({}), false);
});

test('deletePlatformClass posts the generic db/delete batch and maps success', async () => {
    const { calls, restore } = stubFetch({
        success: true,
        deletedRows: 5,
        results: [{ table: 'user_class', deletedRows: 1 }]
    });
    try {
        const result = await deletePlatformClass(executorConfig(), { className: 'heheda', mapping: MAPPING });
        assert.equal(result.deleted, true);
        assert.equal(result.notFound, false);
        assert.equal(result.deletedRows, 5);
        const call = calls[0];
        assert.equal(call.url, 'http://executor.invalid/api/v1/db/delete');
        assert.equal(call.method, 'POST');
        const payload = JSON.parse(call.body);
        assert.equal(payload.system, 'java');
        assert.equal(payload.databaseName, 'cloud_training');
        assert.equal(payload.dryRun, undefined);
        assert.equal(payload.operations.length, 2);
        assert.equal(payload.operations[0].table, 'user_info');
        const classOp = payload.operations[1];
        assert.equal(classOp.table, 'user_class');
        assert.deepEqual(classOp.where, [{ column: 'uc_name', value: 'heheda' }]);
    } finally { restore(); }
});

test('deletePlatformClass treats a zero-row class match as notFound (idempotent)', async () => {
    const { restore } = stubFetch({ success: true, results: [{ table: 'user_class', deletedRows: 0 }] });
    try {
        const result = await deletePlatformClass(executorConfig(), { className: 'gone', mapping: MAPPING });
        assert.equal(result.deleted, false);
        assert.equal(result.notFound, true);
    } finally { restore(); }
});

test('deletePlatformClass surfaces executor business failure with a 502 status', async () => {
    const { restore } = stubFetch({ success: false, error: '数据库连接失败', code: 'db_error' });
    try {
        await assert.rejects(
            deletePlatformClass(executorConfig(), { className: 'heheda', mapping: MAPPING }),
            error => {
                assert.equal(error.statusCode, 502);
                assert.match(error.message, /数据库连接失败/);
                return true;
            }
        );
    } finally { restore(); }
});

test('deletePlatformClass rejects an incomplete mapping before any request', async () => {
    const { calls, restore } = stubFetch({ success: true });
    try {
        await assert.rejects(
            deletePlatformClass(executorConfig(), {
                className: 'heheda',
                mapping: { enabled: true, classTable: 'user_class' }
            }),
            error => {
                assert.match(error.message, /班级删除映射/);
                assert.equal(error.statusCode, undefined);
                return true;
            }
        );
        assert.equal(calls.length, 0);
    } finally { restore(); }
});

test('deletePlatformClass cascades to the user table when configured', async () => {
    const cascadeMapping = {
        enabled: true, apiId: 'svc', databaseName: 'toutiao_basic_jinzhuan',
        classTable: 'ire_class', classNameColumn: 'class_name',
        classIdColumn: 'class_id', userTable: 'user', userClassColumn: 'class_id'
    };
    const { calls, restore } = stubFetch({
        success: true,
        results: [{ table: 'user', deletedRows: 3 }, { table: 'ire_class', deletedRows: 1 }]
    });
    try {
        const result = await deletePlatformClass(executorConfig(), { className: 'mcheheda', mapping: cascadeMapping });
        assert.equal(result.deleted, true);
        assert.equal(result.notFound, false);
        const payload = JSON.parse(calls[0].body);
        assert.equal(payload.databaseName, 'toutiao_basic_jinzhuan');
        assert.equal(payload.operations.length, 2);
        // 先删用户：user WHERE class_id IN (SELECT class_id FROM ire_class WHERE class_name = ?)
        assert.equal(payload.operations[0].table, 'user');
        assert.deepEqual(payload.operations[0].where[0].inSelect, {
            table: 'ire_class', selectColumn: 'class_id', where: [{ column: 'class_name', value: 'mcheheda' }]
        });
        // 再删班级行
        assert.equal(payload.operations[1].table, 'ire_class');
        assert.deepEqual(payload.operations[1].where, [{ column: 'class_name', value: 'mcheheda' }]);
    } finally { restore(); }
});

test('deletePlatformClass rejects a missing className before any request', async () => {
    const { calls, restore } = stubFetch({ success: true });
    try {
        await assert.rejects(deletePlatformClass(executorConfig(), { mapping: MAPPING }), /班级名不能为空/);
        assert.equal(calls.length, 0);
    } finally { restore(); }
});
