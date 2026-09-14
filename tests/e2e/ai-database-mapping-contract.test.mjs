import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractAiJson, inferDatabaseMappingFromSchema, normalizeCandidateTables,
    rankDatabaseTables, validateDatabaseMappingSuggestion
} from '../../server/utils/aiDatabaseMapping.js';
import {
    matchAccountApiService, matchPlatformDatabase, platformIdentity
} from '../../src/utils/databaseAutoMatch.js';

const schemas = [
    { table: 'uc_class', columns: ['uc_id', 'uc_name'] },
    { table: 'uc_user', columns: ['user_name', 'password', 'class_id'] }
];

test('extracts fenced AI JSON and keeps only real candidate tables', () => {
    assert.deepEqual(extractAiJson('```json\n{"candidateTables":["UC_USER"]}\n```'), { candidateTables: ['UC_USER'] });
    assert.deepEqual(
        normalizeCandidateTables(['UC_USER', 'made_up', 'uc_class'], ['uc_class', 'uc_user']),
        ['uc_user', 'uc_class']
    );
});

test('validates account mapping against the inspected schema', () => {
    assert.deepEqual(validateDatabaseMappingSuggestion({
        accountTableName: 'UC_USER',
        accountUsernameColumn: 'USER_NAME',
        accountPasswordColumn: 'password',
        accountPasswordAlgorithm: 'itmc-java-long-md5',
        confidence: 'high',
        reason: '账号字段明确'
    }, schemas, { scope: 'account', provider: 'mysql', ssoMethod: 'java' }), {
        scope: 'account', confidence: 'high', reason: '账号字段明确',
        accountTableName: 'uc_user', accountUsernameColumn: 'user_name',
        accountPasswordColumn: 'password', accountPasswordAlgorithm: 'itmc-java-long-md5'
    });
});

test('requires a complete class and account cascade mapping', () => {
    assert.throws(() => validateDatabaseMappingSuggestion({
        classTable: 'uc_class', classNameColumn: 'uc_name', classIdColumn: 'uc_id',
        userTable: 'uc_user', userClassColumn: 'missing', confidence: 'medium'
    }, schemas, { scope: 'classDelete', provider: 'mysql', ssoMethod: 'java' }), /完整的班级与关联账号映射/);
    assert.deepEqual(validateDatabaseMappingSuggestion({
        classTable: 'uc_class', classNameColumn: 'uc_name', classIdColumn: 'uc_id',
        userTable: 'uc_user', userClassColumn: 'class_id', confidence: 'high'
    }, schemas, { scope: 'classDelete', provider: 'mysql', ssoMethod: 'java' }), {
        scope: 'classDelete', confidence: 'high', reason: '',
        classTable: 'uc_class', classNameColumn: 'uc_name', classIdColumn: 'uc_id',
        userTable: 'uc_user', userClassColumn: 'class_id'
    });
    assert.throws(() => validateDatabaseMappingSuggestion({
        classTable: 'invented', classNameColumn: 'uc_name'
    }, schemas, { scope: 'classDelete', provider: 'mysql' }), /完整的班级与关联账号映射/);
});

test('derives software code, API server and database from the jump address', () => {
    assert.deepEqual(platformIdentity('http://8.138.27.219:8872/YT00127/open'), {
        hostname: '8.138.27.219', code: 'YT00127'
    });
    assert.equal(matchAccountApiService('http://8.138.27.219:8872/YT00127', [
        { id: 'main', enabled: true, endpointUrl: 'http://101.33.200.119:8088' },
        { id: 'mobile', enabled: true, endpointUrl: 'http://8.138.27.219:18088' }
    ])?.id, 'mobile');
    assert.equal(matchPlatformDatabase('http://8.138.27.219:8872/YT00127', [
        'cloud_training_yt00125', 'cloud_training_yt00127'
    ]), 'cloud_training_yt00127');
});

test('uses deterministic table and column fallback when AI is unavailable', () => {
    assert.deepEqual(rankDatabaseTables(['audit_log', 'uc_user', 'uc_class'], 'classDelete', 2), ['uc_class', 'uc_user']);
    assert.deepEqual(inferDatabaseMappingFromSchema(schemas, {
        scope: 'account', provider: 'mysql', ssoMethod: 'java'
    }), {
        accountTableName: 'uc_user', accountUsernameColumn: 'user_name',
        accountPasswordColumn: 'password', accountPasswordAlgorithm: 'itmc-java-long-md5',
        confidence: 'low', reason: 'AI 暂时不可用，已按真实字段结构完成规则匹配，请保存前复核'
    });
});
