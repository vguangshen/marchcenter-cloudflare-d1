import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('competition editor reveals an existing Admin or Root password only through the protected credential endpoint', async () => {
    const source = await readFile(new URL('../../src/components/modals/EditModal.jsx', import.meta.url), 'utf8');

    assert.match(source, /api\.get\(`\/sso\/admin-credential\/\$\{cardId\}`/);
    assert.match(source, /adminEntryPassword:\s*credential\.password/);
    assert.match(source, /type=\{showAdminEntryPassword \? ['"]text['"] : ['"]password['"]\}/);
    assert.match(source, /已回显/);
    assert.doesNotMatch(source, /adminEntryCredentials/);
});
