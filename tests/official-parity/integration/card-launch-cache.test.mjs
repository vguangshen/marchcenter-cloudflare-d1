import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('every card launch requests a fresh server-side official execution', async () => {
    const actions = await readFile(new URL('../../../src/hooks/useCompetitionActions.js', import.meta.url), 'utf8');
    assert.match(actions, /api\.stream\('\/sso\/execute\/stream'/);
    assert.doesNotMatch(actions, /canUseCachedSsoLaunch|teacherLaunchUrl|studentLaunchUrl/);
});
