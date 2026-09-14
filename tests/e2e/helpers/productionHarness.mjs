import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Log, LogLevel, Miniflare } from 'miniflare';
import { signToken } from '../../../server/utils/token.js';
import { hashPassword } from '../../../server/utils/password.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const JWT_SECRET = 'e2e-jwt-secret-not-production';
const CONFIG_SECRET = 'e2e-config-secret-not-production';
const execFileAsync = promisify(execFile);

function xmlDecode(value) {
    return String(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlValues(body, name) {
    const values = [];
    const expression = new RegExp(`<(?:(?:[\\w.-]+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, 'gi');
    let match;
    while ((match = expression.exec(body))) values.push(xmlDecode(match[1].replace(/<[^>]+>/g, '')));
    return values;
}

function soapResult(operationName, result) {
    const serialized = JSON.stringify(result).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><${operationName}Response xmlns="http://tempuri.org/"><${operationName}Result>${serialized}</${operationName}Result></${operationName}Response></soapenv:Body></soapenv:Envelope>`;
}

function result(data, overrides = {}) {
    return { code: overrides.code ?? 10000, succ: overrides.succ ?? true, message: overrides.message ?? '成功', data };
}

class CaptureLog extends Log {
    constructor(records) {
        super(LogLevel.INFO, { prefix: 'e2e' });
        this.records = records;
    }
    error(value) { this.records.push({ level: 'error', value: String(value?.stack || value) }); }
    warn(value) { this.records.push({ level: 'warn', value: String(value) }); }
    info(value) { this.records.push({ level: 'info', value: String(value) }); }
    debug(value) { this.records.push({ level: 'debug', value: String(value) }); }
}

export function createMockPlatform() {
    const state = {
        requests: [], groups: new Map(), students: new Set(), teachers: new Set(),
        javaResponses: new Map(), soapResponses: new Map(), tokenSequence: 0
    };

    const queue = (map, operationName, values) => {
        map.set(operationName, Array.isArray(values) ? values.slice() : [values]);
    };
    const nextOverride = (map, operationName) => {
        const values = map.get(operationName);
        if (!values?.length) return undefined;
        const value = values.shift();
        if (!values.length) map.delete(operationName);
        return value;
    };

    return {
        state,
        queueJava(operationName, values) { queue(state.javaResponses, operationName, values); },
        queueSoap(operationName, values) { queue(state.soapResponses, operationName, values); },
        reset() {
            state.requests.length = 0;
            state.groups.clear(); state.students.clear(); state.teachers.clear();
            state.javaResponses.clear(); state.soapResponses.clear(); state.tokenSequence = 0;
        },
        async fetch(request) {
            const url = new URL(request.url);
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
                throw new Error(`E2E outbound blocked non-loopback host: ${url.hostname}`);
            }
            const body = request.method === 'GET' ? '' : await request.text();
            const soapAction = request.headers.get('soapaction');
            const operationName = soapAction
                ? soapAction.replace(/^"|"$/g, '').split('/').pop()
                : url.pathname.split('/').filter(Boolean).pop();
            const platformToken = request.headers.get('platformtoken');
            const sign = request.headers.get('sign');
            const record = {
                host: url.host,
                path: url.pathname,
                search: url.search,
                method: request.method,
                operationName,
                contentType: request.headers.get('content-type') || '',
                soapAction: soapAction || '',
                platformToken: platformToken ? '[REDACTED]' : '',
                platformTokenKind: platformToken?.startsWith('{') ? 'credential-json' : (platformToken ? 'token' : 'none'),
                sign: sign ? '[REDACTED]' : '',
                body: soapAction ? body : Object.fromEntries(new URLSearchParams(body))
            };
            state.requests.push(record);

            if (request.method === 'GET' && /NormWebService\.asmx$/i.test(url.pathname)) {
                return new Response('<definitions><service name="NormWebService"></service></definitions>', {
                    headers: { 'Content-Type': 'text/xml' }
                });
            }

            if (!soapAction) {
                const override = nextOverride(state.javaResponses, operationName);
                if (override instanceof Error) throw override;
                if (override !== undefined) return Response.json(override);
                if (operationName.toLowerCase() === 'login.aspx'
                    && url.searchParams.get('op') === 'loaduserscore') {
                    const username = url.searchParams.get('usernames') || '';
                    const expertName = url.searchParams.get('expertname') || '';
                    const expertuserdata = encodeURIComponent(JSON.stringify({
                        ServerConfig: 'itmc',
                        ExpertName: expertName,
                        UserName: username
                    }));
                    return Response.json({
                        code: 10010,
                        succ: true,
                        data: JSON.stringify([{
                            username,
                            state: 3,
                            score: null,
                            scorestate: 0,
                            data: expertuserdata
                        }])
                    });
                }
                if (operationName === 'tokenInfo') {
                    state.tokenSequence += 1;
                    return Response.json(result(`PLATFORM_TOKEN_${state.tokenSequence}`));
                }
                if (operationName === 'getLoginTeacherName') return Response.json(result('teacher ticket +%&'));
                if (operationName === 'trainingExamPaper' || operationName === 'trainingExamPaperV2') {
                    return Response.json(result('student ticket +%&'));
                }
                if (operationName === 'getUserName') {
                    const form = new URLSearchParams(body);
                    state.students.add(form.get('u'));
                    return Response.json(result(form.get('u')));
                }
                return Response.json(result(true));
            }

            const override = nextOverride(state.soapResponses, operationName);
            if (override instanceof Error) throw override;
            if (override !== undefined) return new Response(soapResult(operationName, override), {
                headers: { 'Content-Type': 'text/xml; charset=utf-8' }
            });

            let responseResult;
            if (operationName === 'IsGroupExisted') {
                const groupName = xmlValues(body, 'groupName')[0] || '';
                responseResult = result(state.groups.get(groupName) || null);
            } else if (operationName.startsWith('Add') && operationName.endsWith('Group')) {
                const groupName = xmlValues(body, 'groupName')[0] || '';
                const groupID = `group-${state.groups.size + 1}`;
                state.groups.set(groupName, groupID);
                responseResult = result(groupID);
            } else if (operationName === 'IsStuExisted') {
                const requested = xmlValues(body, 'string');
                responseResult = result(JSON.stringify(requested.filter(value => state.students.has(value))));
            } else if (operationName === 'IsTeacherExisted') {
                const requested = xmlValues(body, 'string');
                responseResult = result(JSON.stringify(requested.filter(value => state.teachers.has(value))));
            } else if (operationName === 'AddStudent') {
                const accounts = xmlValues(body, 'StudentID');
                accounts.forEach(value => state.students.add(value));
                responseResult = result(JSON.stringify(accounts));
            } else if (operationName === 'AddTeacher') {
                const accounts = xmlValues(body, 'string');
                accounts.forEach(value => state.teachers.add(value));
                responseResult = result(JSON.stringify(accounts));
            } else {
                responseResult = result(true);
            }
            return new Response(soapResult(operationName, responseResult), {
                headers: { 'Content-Type': 'text/xml; charset=utf-8' }
            });
        }
    };
}

async function applyMigrations(database) {
    const directory = path.join(ROOT, 'migrations');
    const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of names) {
        const source = await readFile(path.join(directory, name), 'utf8');
        // Miniflare D1 enables foreign keys itself and its exec splitter rejects
        // standalone PRAGMA statements. Keep production migrations untouched.
        const sql = source
            .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;\s*/i, '')
            .replace(/^\s*--.*$/gm, '')
            .replace(/\r?\n/g, ' ');
        await database.exec(sql);
    }
}

export async function createProductionHarness(options = {}) {
    const platform = createMockPlatform();
    const logs = [];
    const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'marchcenter-e2e-'));
    await execFileAsync(process.execPath, [
        path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'),
        'deploy', '--dry-run', '--outdir', bundleDirectory
    ], { cwd: ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const bundlePath = path.join(bundleDirectory, 'index.js');

    // Assets：优先用真实 dist（已构建时），缺失时用临时桩目录，
    // 保证 SPA fallback / 资源 404 行为可以端到端验证。
    let assetsDirectory = options.assetsDirectory || path.join(ROOT, 'dist');
    if (!existsSync(path.join(assetsDirectory, 'index.html'))) {
        assetsDirectory = await mkdtemp(path.join(os.tmpdir(), 'marchcenter-assets-'));
        await writeFile(path.join(assetsDirectory, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
    }

    const miniflare = new Miniflare({
        modules: true,
        scriptPath: bundlePath,
        compatibilityDate: '2026-07-17',
        compatibilityFlags: ['nodejs_compat'],
        // wrangler deploy --dry-run 会把 MozJPEG 的 .wasm 打包成独立模块；
        // miniflare 需要显式声明 CompiledWasm 规则才能加载它们。
        modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
        assets: {
            directory: assetsDirectory,
            binding: 'ASSETS',
            routerConfig: {
                static_routing: { user_worker: ['/api/*'] },
                has_user_worker: true
            },
            assetConfig: {
                not_found_handling: 'none'
            }
        },
        bindings: {
            NODE_ENV: 'production', JWT_SECRET, SSO_CONFIG_ENCRYPTION_KEY: CONFIG_SECRET,
            INITIAL_ADMIN_BOOTSTRAP_SECRET: options.bootstrapSecret || 'e2e-bootstrap-secret',
            ALLOW_HTTP_PLATFORMS: 'true', SSO_OUTBOUND_TIMEOUT_MS: '2000',
            SSO_MAX_RESPONSE_BYTES: '1048576', SOAP_TICKET_TYPE: 'itmc',
            // 调试缓存头默认开启，供 HIT/MISS 断言；关闭用 wallpaperCacheDebug: '0'。
            WALLPAPER_CACHE_DEBUG: options.wallpaperCacheDebug === '0' ? '0' : '1',
            // Keep existing route tests request-isolated.  Dedicated cache
            // tests opt into the Worker isolate cache explicitly.
            OFFICIAL_TOKEN_CACHE_SCOPE: options.officialTokenCacheScope || 'request'
        },
        d1Databases: { DB: `e2e-${crypto.randomUUID()}` },
        r2Buckets: { WALLPAPERS: options.r2BucketName || `e2e-wallpapers-${crypto.randomUUID()}` },
        outboundService: request => platform.fetch(request),
        log: new CaptureLog(logs),
        ...(options.port ? { host: '127.0.0.1', port: options.port } : {})
    });
    const database = await miniflare.getD1Database('DB');
    await applyMigrations(database);
    const passwordHash = options.adminPassword
        ? await hashPassword(options.adminPassword)
        : 'unused';
    await database.prepare(
        `INSERT INTO users (id, username, email, password_hash, role, is_disabled)
         VALUES (1, 'e2e-admin', 'e2e@example.invalid', ?, 'super_admin', 0)`
    ).bind(passwordHash).run();
    const token = await signToken({ id: 1, username: 'e2e-admin', role: 'super_admin' }, JWT_SECRET);

    const api = async (pathname, options = {}) => {
        const response = await miniflare.dispatchFetch(`http://marchcenter.local${pathname}`, {
            method: options.method || (options.body === undefined ? 'GET' : 'POST'),
            headers: {
                Authorization: `Bearer ${token}`,
                ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(options.headers || {})
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const text = await response.text();
        let data = text;
        try { data = JSON.parse(text); } catch { /* SSE/text remains raw */ }
        return { response, status: response.status, text, data };
    };

    return {
        miniflare, database, platform, logs, token, api,
        async reset() {
            platform.reset(); logs.length = 0;
            await database.exec(`
                DELETE FROM admin_entry_launch_tokens;
                DELETE FROM d1_locks;
                DELETE FROM user_platform_account_status;
                DELETE FROM user_workflow_status;
                DELETE FROM user_competition_student_accounts;
                DELETE FROM user_competition_expert_student_bindings;
                DELETE FROM user_competition_expert_accounts;
                DELETE FROM user_class_removals;
                DELETE FROM user_login_locations;
                DELETE FROM module_init_confirmations;
                DELETE FROM competitions;
                DELETE FROM sso_configs;
                UPDATE users SET last_seen_at = NULL, last_ip = NULL, user_agent = NULL;
            `);
        },
        async seedConfig(config, { name = 'E2E config', baseUrl = '', id } = {}) {
            const statement = id
                ? database.prepare('INSERT INTO sso_configs (id, name, base_url, config_data) VALUES (?, ?, ?, ?)').bind(id, name, baseUrl, JSON.stringify(config))
                : database.prepare('INSERT INTO sso_configs (name, base_url, config_data) VALUES (?, ?, ?)').bind(name, baseUrl, JSON.stringify(config));
            const resultValue = await statement.run();
            return Number(id || resultValue.meta.last_row_id);
        },
        async seedCompetition({ configId, method, url = 'http://localhost:9289/DS50108', classType = 1, id } = {}) {
            const resultValue = await database.prepare(
                `INSERT INTO competitions (id, title, url, sso_config_id, sso_method, class_type)
                 VALUES (?, 'E2E competition', ?, ?, ?, ?)`
            ).bind(id || null, url, configId, method, classType).run();
            return Number(id || resultValue.meta.last_row_id);
        },
        async rows(sql, ...values) {
            return (await database.prepare(sql).bind(...values).all()).results;
        },
        async run(sql, ...values) {
            return database.prepare(sql).bind(...values).run();
        },
        async seedUser({ id, username, role }) {
            await database.prepare(
                `INSERT INTO users (id, username, email, password_hash, role, is_disabled)
                 VALUES (?, ?, ?, 'unused', ?, 0)
                 ON CONFLICT(id) DO UPDATE SET
                     username = excluded.username,
                     email = excluded.email,
                     role = excluded.role,
                     is_disabled = 0`
            ).bind(id, username, `${username}@example.invalid`, role).run();
        },
        issueToken({ id, username, role }) {
            return signToken({ id, username, role }, JWT_SECRET);
        },
        async dispose() {
            await miniflare.dispose();
            await rm(bundleDirectory, { recursive: true, force: true });
            if (assetsDirectory !== path.join(ROOT, 'dist')) {
                await rm(assetsDirectory, { recursive: true, force: true });
            }
        }
    };
}

export const E2E_SECRETS = Object.freeze({
    soapPassword: 'SOAP_PASSWORD_E2E', tokenPassword: 'TOKEN_PASSWORD_E2E',
    tokenNumber: 'TOKEN_NUMBER_E2E', soapUsername: 'SOAP_USER_E2E',
    platformToken: 'PLATFORM_TOKEN_1', userPassword: 'USER_PASSWORD_E2E'
});

export function officialConfig(method, overrides = {}) {
    const common = {
        method,
        officialBaseUrl: 'http://localhost:9289/DS50108',
        officialBaseUrlConfirmed: true,
        allowHttp: true,
        serviceName: method === 'java' ? 'NewTrainingInterfaceUtilService'
            : method === 'net' ? 'NetGeneralStandardInterfaceUtilService'
                : method === 'marketing' ? 'ShichangyingxiaoshapanInterfaceUtilService'
                    : method === 'commerce' ? 'WangdianyunyingtuiguangGJshapanInterfaceUtilService'
                        : method === 'managementAccounting' ? 'GuanlikuaijiGJshapanInterfaceUtilService'
                            : method === 'crossBorderCommerce' ? 'KuajingdianshangshapanInterfaceUtilService'
                                : method === 'enterpriseManagement' ? 'QiyeguanlishapanInterfaceUtilService' : 'jump',
        classPrefix: 'mc', teacherPrefix: 'mc', studentPrefix: 'mcs', studentSuffix: '1',
        roleName: 'student', teamName: '', flag: '1', trainOrExam: 'train',
        classType: 1, maxRunYear: 0, autoDeal: false, startExam: true,
        tokenNumber: E2E_SECRETS.tokenNumber, tokenPassword: E2E_SECRETS.tokenPassword,
        soapUsername: E2E_SECRETS.soapUsername, soapPassword: E2E_SECRETS.soapPassword
    };
    return { ...common, ...overrides };
}
