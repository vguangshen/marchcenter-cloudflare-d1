import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../src/components/views/settings/UserManager.jsx', import.meta.url), 'utf8');

test('user status action keeps the same 32px square footprint as reset password', () => {
    assert.match(source, /className=\{`flex h-8 w-8 shrink-0 items-center justify-center/);
    assert.match(source, /aria-label=\{user\.is_disabled \? `启用用户/);
});
