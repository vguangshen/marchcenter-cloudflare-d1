import { getRuntime } from './runtime.js';

function normalizeValue(value) {
    if (value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'bigint') return Number(value);
    if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
        return JSON.stringify(value);
    }
    return value;
}

function expandArrayParams(sql, params = []) {
    let index = 0;
    const flattened = [];
    const expandedSql = sql.replace(/\?/g, () => {
        const value = params[index++];
        if (Array.isArray(value)) {
            if (!value.length) return 'NULL';
            flattened.push(...value.map(normalizeValue));
            return value.map(() => '?').join(', ');
        }
        flattened.push(normalizeValue(value));
        return '?';
    });
    if (index < params.length) flattened.push(...params.slice(index).map(normalizeValue));
    return { sql: expandedSql, params: flattened };
}

function normalizeSql(source) {
    let sql = String(source || '').trim();
    sql = sql.replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP');
    sql = sql.replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO');
    sql = sql.replace(/\bIF\s*\(/gi, 'IIF(');
    sql = sql.replace(/\s+AFTER\s+[`"\w]+/gi, '');
    return sql;
}

function isSchemaMaintenance(sql) {
    return /^(CREATE\s+TABLE|ALTER\s+TABLE)/i.test(sql);
}

function sqliteError(error) {
    const message = String(error?.message || error || 'D1 query failed');
    const wrapped = new Error(message);
    if (/duplicate column name/i.test(message)) wrapped.code = 'ER_DUP_FIELDNAME';
    else if (/already exists/i.test(message) && /index/i.test(message)) wrapped.code = 'ER_DUP_KEYNAME';
    else if (/no such table/i.test(message)) wrapped.code = 'ER_NO_SUCH_TABLE';
    else if (/UNIQUE constraint failed/i.test(message)) wrapped.code = 'ER_DUP_ENTRY';
    return wrapped;
}

async function runQuery(rawSql, rawParams = []) {
    const database = getRuntime().env.DB;
    if (!database) throw new Error('D1 binding DB is not configured');

    const normalized = normalizeSql(rawSql);
    // Schema is versioned in /migrations. Runtime schema changes are disabled because D1 migrations own the schema.
    if (isSchemaMaintenance(normalized)) return [{ affectedRows: 0, insertId: 0 }, []];

    const { sql, params } = expandArrayParams(normalized, rawParams);
    try {
        const statement = database.prepare(sql).bind(...params);
        const returnsRows = /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
        if (returnsRows) {
            const result = await statement.all();
            const rows = result.results || [];
            const fields = rows.length ? Object.keys(rows[0]).map(name => ({ name })) : [];
            return [rows, fields];
        }
        const result = await statement.run();
        return [{
            affectedRows: Number(result.meta?.changes || 0),
            changedRows: Number(result.meta?.changes || 0),
            insertId: Number(result.meta?.last_row_id || 0)
        }, []];
    } catch (error) {
        throw sqliteError(error);
    }
}

function preparedStatement(database, rawSql, rawParams = []) {
    const normalized = normalizeSql(rawSql);
    if (isSchemaMaintenance(normalized)) return null;
    const { sql, params } = expandArrayParams(normalized, rawParams);
    return database.prepare(sql).bind(...params);
}

async function runBatch(queries = []) {
    const database = getRuntime().env.DB;
    if (!database) throw new Error('D1 binding DB is not configured');
    if (!Array.isArray(queries) || !queries.length) return [];
    const statements = queries
        .map(item => Array.isArray(item)
            ? preparedStatement(database, item[0], item[1] || [])
            : preparedStatement(database, item.sql, item.params || []))
        .filter(Boolean);
    if (!statements.length) return [];
    try {
        const results = await database.batch(statements);
        return results.map(result => ({
            rows: result.results || [],
            affectedRows: Number(result.meta?.changes || 0),
            insertId: Number(result.meta?.last_row_id || 0),
            meta: result.meta || {}
        }));
    } catch (error) {
        throw sqliteError(error);
    }
}

const pool = {
    query: runQuery,
    execute: runQuery,
    batch: runBatch,
    async end() {}
};

export function getDatabaseConfig() {
    return {
        provider: 'Cloudflare D1',
        binding: 'DB',
        database: 'marchcenter-db',
        source: 'cloudflare-binding',
        passwordConfigured: false
    };
}

export async function testDatabaseConfig() {
    const started = Date.now();
    const [[row]] = await runQuery("SELECT 'D1 SQLite' AS version, 'marchcenter-db' AS databaseName");
    return { ...row, latencyMs: Date.now() - started, config: getDatabaseConfig() };
}

export async function applyDatabaseConfig() {
    const error = new Error('D1 数据库通过 Cloudflare 绑定管理，不能在网页中切换连接');
    error.status = 400;
    throw error;
}

export default pool;
