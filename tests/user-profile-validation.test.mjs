import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_AVATAR_BYTES, normalizeAvatarDataUrl } from '../server/utils/userProfile.js';

test('avatar accepts the exact production size/type contract and rejects malformed or larger payloads', () => {
    assert.equal(normalizeAvatarDataUrl(null), null);
    assert.equal(normalizeAvatarDataUrl(''), null);
    const max = `data:image/webp;base64,${Buffer.alloc(MAX_AVATAR_BYTES).toString('base64')}`;
    assert.equal(normalizeAvatarDataUrl(max), max);
    assert.throws(() => normalizeAvatarDataUrl(`data:image/webp;base64,${Buffer.alloc(MAX_AVATAR_BYTES + 1).toString('base64')}`), /100KB/);
    assert.throws(() => normalizeAvatarDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), /仅支持/);
    assert.throws(() => normalizeAvatarDataUrl('data:image/png;base64,AAAA=Z'), /仅支持/);
    assert.throws(() => normalizeAvatarDataUrl({ data: 'avatar' }), /100KB/);
});
