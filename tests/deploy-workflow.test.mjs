import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { runDeployment, verifyProductionRelease } from '../scripts/deploy.mjs';

const commit = 'a'.repeat(40);
const cwd = path.resolve('release-fixture');
const npmCli = path.join(cwd, 'npm-cli.js');

function fixture({ statuses = ['', ''], commits = [commit, commit], failStage } = {}) {
    const calls = [];
    const verified = [];
    return {
        calls, verified,
        options: {
            cwd,
            npmCli,
            verify: async version => { verified.push(version); },
            run: async (command, args, options) => {
                calls.push({ command, args, options });
                if (command === 'git' && args[0] === 'status') return statuses.shift() ?? '';
                if (command === 'git' && args[0] === 'rev-parse') return commits.shift() ?? commit;
                if (failStage && args.includes(failStage)) throw new Error(`Failed ${failStage}`);
                return '';
            }
        }
    };
}

test('release validates before publishing and records the validated commit', async () => {
    const { options, calls, verified } = fixture();
    assert.deepEqual(await runDeployment(options), { commit, dryRun: false });
    assert.deepEqual(calls.map(call => call.args[0]), ['status', 'rev-parse', npmCli, npmCli, 'status', 'rev-parse', path.join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js')]);
    assert.deepEqual(calls[2].args, [npmCli, 'run', 'check']);
    assert.deepEqual(calls[3].args, [npmCli, 'test']);
    assert.deepEqual(calls.at(-1).args.slice(1), ['deploy', '--var', `APP_COMMIT_SHA:${commit}`]);
    assert.ok(calls.every(call => call.options.cwd === cwd));
    assert.deepEqual(verified, [commit]);
});

test('dry run keeps all validation gates and never publishes', async () => {
    const { options, calls, verified } = fixture();
    assert.deepEqual(await runDeployment({ ...options, dryRun: true }), { commit, dryRun: true });
    assert.equal(calls.length, 7);
    assert.equal(calls.at(-1).args.at(-1), '--dry-run');
    assert.deepEqual(verified, []);
});

test('release verification waits for the requested version and D1 on every domain', async () => {
    const origins = ['https://primary.example', 'https://secondary.example'];
    const calls = new Map();
    const request = async url => {
        const count = (calls.get(url.href) || 0) + 1;
        calls.set(url.href, count);
        if (url.pathname === '/api/version') return Response.json({ commit: count > 1 ? commit : null });
        return Response.json({ ready: url.origin === origins[0] || count >= 3 });
    };
    await verifyProductionRelease(commit, { origins, fetchImplementation: request, attempts: 3, retryDelayMs: 0 });
    assert.equal(calls.get(`${origins[0]}/api/ready`), 2);
    assert.equal(calls.get(`${origins[1]}/api/ready`), 3);
    await assert.rejects(verifyProductionRelease(commit, {
        origins, attempts: 1,
        fetchImplementation: async url => url.pathname === '/api/version'
            ? Response.json({ commit }) : Response.json({ ready: false }, { status: 503 })
    }), /Cloudflare accepted the upload.*api\/ready returned HTTP 503/);
});

test('initial tracked or untracked changes prevent validation and publishing', async () => {
    for (const status of [' M src/App.jsx\n', '?? new-source.js\n']) {
        const { options, calls } = fixture({ statuses: [status] });
        await assert.rejects(runDeployment(options), /clean working tree/);
        assert.equal(calls.length, 1);
    }
});

test('failed check or test prevents publishing', async () => {
    for (const failStage of ['check', 'test']) {
        const { options, calls } = fixture({ failStage });
        await assert.rejects(runDeployment(options), new RegExp(`Failed ${failStage}`));
        assert.equal(calls.some(call => call.args.includes('deploy')), false);
    }
});

test('working tree or commit changes during validation prevent publishing', async () => {
    for (const changes of [{ statuses: ['', ' M src/App.jsx\n'] }, { commits: [commit, 'b'.repeat(40)] }]) {
        const { options, calls } = fixture(changes);
        await assert.rejects(runDeployment(options), /clean working tree|commit changed/);
        assert.equal(calls.some(call => call.args.includes('deploy')), false);
    }
});

test('invalid version and unavailable npm invocation stop safely', async () => {
    const { options, calls } = fixture({ commits: ['not-a-git-hash'] });
    await assert.rejects(runDeployment(options), /valid Git commit/);
    assert.equal(calls.length, 2);
    await assert.rejects(runDeployment({ ...options, npmCli: '' }), /through npm run/);
    assert.equal(calls.length, 2);
});
