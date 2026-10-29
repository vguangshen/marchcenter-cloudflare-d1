import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = await mkdtemp(path.join(os.tmpdir(), 'marchcenter-test-bundle-'));
const started = Date.now();
const e2eOnly = process.argv.includes('--e2e');
async function run(args, env = process.env) {
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 1));
    });
    if (code !== 0) throw Object.assign(new Error(`Test stage exited ${code}`), { exitCode: code });
}
async function files(directory) {
    const result = [];
    for (const item of await readdir(path.join(root, directory), { withFileTypes: true })) {
        if (item.isFile() && item.name.endsWith('.test.mjs')) result.push(path.join(directory, item.name));
    }
    return result.sort();
}
try {
    // Build once per suite. Each test still gets an independent database,
    // storage bucket and Worker isolate from createProductionHarness.
    await run(['node_modules/vite/bin/vite.js', 'build']);
    await run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', output]);
    const env = {
        ...process.env,
        MARCHCENTER_TEST_WORKER_BUNDLE: path.join(output, 'index.js'),
        MARCHCENTER_TEST_BUILD_READY: '1'
    };
    if (!e2eOnly) {
        await run(['--test', ...await files('tests/frontend'), ...await files('tests')], env);
        const official = [];
        for (const directory of ['tests/official-parity', 'tests/official-parity/soap-business', 'tests/official-parity/java', 'tests/official-parity/integration', 'tests/official-parity/canary']) {
            official.push(...await files(directory));
        }
        await run(['--test', ...official], env);
    }
    await run(['--test', '--test-concurrency=1', ...await files('tests/e2e')], env);
    if (!e2eOnly) {
        for (const name of ['account-management-crypto', 'wallpaper-engine', 'wallpaper-progressive', 'email-service', 'registration', 'platform-hardening']) {
            await run([`scripts/test-${name}.mjs`], env);
        }
    }
    process.stdout.write(`All validation stages passed in ${((Date.now() - started) / 1000).toFixed(1)}s.\n`);
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode || 1;
} finally {
    await rm(output, { recursive: true, force: true });
}
