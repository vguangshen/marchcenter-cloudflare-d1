import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const editModal = await readFile(new URL('../../src/components/modals/EditModal.jsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');
const competitionsRoute = await readFile(new URL('../../server/routes/competitions.js', import.meta.url), 'utf8');
const ssoRoute = await readFile(new URL('../../server/routes/sso.js', import.meta.url), 'utf8');
const accountApi = await readFile(new URL('../../server/utils/accountManagementApi.js', import.meta.url), 'utf8');

test('Java class delete mapping keeps all four core choices visible', () => {
    assert.match(editModal, /账号管理 API 服务器[\s\S]*班级所在数据库[\s\S]*班级数据表[\s\S]*班级名称字段/);
    assert.doesNotMatch(editModal, /\{classDeleteApiId && \([\s\S]{0,400}班级所在数据库/);
    assert.doesNotMatch(editModal, /\{classDeleteDatabaseName && \([\s\S]{0,400}班级数据表/);
    assert.doesNotMatch(editModal, /\{classDeleteClassTable && \([\s\S]{0,400}班级名称字段/);
    assert.match(editModal, /班级名称字段[\s\S]*同时删除关联账号[\s\S]*班级主键字段[\s\S]*账号数据表[\s\S]*账号关联字段/);
    assert.doesNotMatch(editModal, /classDeleteCoreReady|高级，可选|只有需要删班时/);
    assert.match(editModal, /hasCompleteClassDeleteMapping[\s\S]*classIdColumn[\s\S]*userTable[\s\S]*userClassColumn/);
});

test('account and Java mapping panels expose guarded AI autofill actions', () => {
    assert.match(editModal, /runAiMapping\('account'\)/);
    assert.match(editModal, /runAiMapping\('classDelete'\)/);
    assert.match(editModal, /\/ai\/database-mapping/);
    assert.match(editModal, /timeoutMs: 150_000/);
    assert.match(editModal, /matchAccountApiService\(formData\.url, accountApiServices\)/);
    assert.match(editModal, /matchPlatformDatabase\(formData\.url, accountDatabases\)/);
    assert.match(editModal, /仅分析表名与字段名，不读取账号内容/);
    assert.match(editModal, /AI 自动识别班级与关联账号映射/);
    assert.match(editModal, /ai-mapping-card[\s\S]*?is-ai-scanning/);
    assert.equal((editModal.match(/className="ai-mapping-trigger"/g) || []).length, 2);
    assert.doesNotMatch(editModal, /AI 智能定位账号表|AI 识别班级与关联账号映射<\/div>/);
});

test('account connection card keeps all location fields visible in a compact grid', () => {
    assert.match(editModal, /账号数据库连接与定位[\s\S]*API 服务器[\s\S]*数据库类型[\s\S]*对应数据库名称[\s\S]*对应账号数据表[\s\S]*账号定位字段[\s\S]*用户名字段[\s\S]*密码字段[\s\S]*密码算法/);
    assert.doesNotMatch(editModal, /\{formData\.accountDbProvider && formData\.accountDbName && formData\.accountTableName && \(/);
    assert.match(editModal, /sm:grid-cols-\[1fr_140px\][\s\S]*对应数据库名称[\s\S]*对应账号数据表[\s\S]*sm:grid-cols-3/);
    assert.match(editModal, /AI 一次识别账号表、用户名、密码字段和算法/);
});

test('manual credential restore exposes a masked optional original ciphertext input', () => {
    assert.match(editModal, /提取密码后自动恢复免密登录[\s\S]*原始密码密文（可选）/);
    assert.match(editModal, /restoreOriginalPasswordBeforeSso \? 'mt-2 grid-rows-\[1fr\] opacity-100' : 'mt-0 grid-rows-\[0fr\] opacity-0'/);
    assert.match(editModal, /aria-hidden=\{!formData\.restoreOriginalPasswordBeforeSso\}/);
    assert.match(editModal, /type=\{showRestoreCiphertext \? 'text' : 'password'\}/);
    assert.match(editModal, /hasRestoreOriginalPasswordCiphertext[\s\S]*已保存/);
    assert.match(editModal, /留空时由执行端首次提取后自动写入/);
    assert.match(competitionsRoute, /restore_original_password_ciphertext AS restoreOriginalPasswordCiphertext/);
    assert.match(competitionsRoute, /if \(!isSuperAdmin\(req\.user\)\) delete parsed\.restoreOriginalPasswordCiphertext/);
    assert.match(ssoRoute, /restoreCard\.restoreOriginalPasswordCiphertext \|\| ''/);
    assert.match(accountApi, /originalPasswordCiphertext \}/);
    assert.match(accountApi, /const originalPasswordCiphertext = String\(data\.originalPasswordCiphertext/);
    assert.match(ssoRoute, /!card\.restoreOriginalPasswordCiphertext && credential\.originalPasswordCiphertext[\s\S]*UPDATE competitions[\s\S]*restore_original_password_ciphertext = \?/);
    assert.doesNotMatch(ssoRoute, /credential:\s*\{[\s\S]{0,300}originalPasswordCiphertext/);
});

test('class name and required account relation identifiers have distinct labels', () => {
    assert.match(editModal, /班级名称字段/);
    assert.match(editModal, /班级主键用于关联账号表，两者含义不同/);
    assert.match(editModal, /班级主键字段/);
    assert.match(editModal, /账号数据表/);
    assert.match(editModal, /账号关联字段/);
    assert.doesNotMatch(editModal, />班级名列</);
    assert.doesNotMatch(editModal, />班级ID列</);
});

test('AI fills class and account cascade mapping in one request', () => {
    assert.match(editModal, /classIdColumn: suggestion\.classIdColumn \|\| ''/);
    assert.match(editModal, /userTable: suggestion\.userTable \|\| ''/);
    assert.match(editModal, /userClassColumn: suggestion\.userClassColumn \|\| ''/);
    assert.match(editModal, /AI 自动填充会一次识别下方三项/);
});

test('changing an upstream mapping clears stale dependent selections', () => {
    assert.match(editModal, /if \(key === 'apiId'\)[\s\S]*databaseName: '', classTable: '', classNameColumn: ''/);
    assert.match(editModal, /else if \(key === 'databaseName'\)[\s\S]*classTable: '', classNameColumn: '', classIdColumn: ''/);
    assert.match(editModal, /else if \(key === 'classTable'\)[\s\S]*classNameColumn: '', classIdColumn: ''/);
    assert.match(editModal, /else if \(key === 'userTable'\)[\s\S]*mapping\.userClassColumn = ''/);
});

test('obsolete real-class preview control and route are removed', () => {
    assert.doesNotMatch(editModal, /用一个真实班级名测试|预览删除结果|class-delete\/check/);
});

test('AI mapping cards use an animated, motion-safe liquid border', () => {
    assert.match(styles, /\.ai-mapping-card\.is-ai-scanning::before/);
    assert.match(styles, /conic-gradient\(from var\(--ai-border-angle/);
    assert.match(styles, /@keyframes ai-mapping-border-run/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-mapping-card\.is-ai-scanning/);
});
