import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = pathname => readFile(new URL(`../../${pathname}`, import.meta.url), 'utf8');

test('add account modal defaults to single creation and contains no text-import flow', async () => {
    const source = await readSource('src/components/modals/AddUserModal.jsx');

    assert.match(source, /useState\(['"]single['"]\)/);
    assert.match(source, /if \(roles\.includes\(['"]teacher['"]\)\) return ['"]teacher['"]/);
    assert.match(source, /useState\(\(\) => defaultRoleFor\(currentUser\?\.role\)\)/);
    assert.match(source, /setSelectedRole\(defaultRoleFor\(currentUser\?\.role\)\)/);
    assert.match(source, /单条添加/);
    assert.match(source, /批量生成/);
    assert.doesNotMatch(source, /文本导入|importText|importPreview|FileText|mode\s*===\s*['"]import['"]/);
    assert.doesNotMatch(source, /结束编号|编号位数|genPreview\.map/);
});

test('delete account modal only supports searchable visual selection', async () => {
    const source = await readSource('src/components/modals/DeleteUserModal.jsx');

    assert.match(source, /搜索用户名或邮箱/);
    assert.match(source, /selectedIds/);
    assert.doesNotMatch(source, /输入用户名|inputText|setMode|mode\s*===\s*['"]input['"]|<textarea/);
});
