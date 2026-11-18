import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const productionOrigins = ['https://marchcenter.top', 'https://mcgo.app'];

async function execute(command, args, { cwd, capture = false }) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            shell: false,
            windowsHide: true,
            stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
        });
        let stdout = '';
        if (capture) child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
        child.once('error', reject);
        child.once('exit', code => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${path.basename(command)} exited with code ${code ?? 'unknown'}`));
        });
    });
}

export async function verifyProductionRelease(commit, {
    origins = productionOrigins, fetchImplementation = globalThis.fetch,
    attempts = 8, retryDelayMs = 3000
} = {}) {
    await Promise.all(origins.map(async origin => {
        async function read(pathname) {
            const response = await fetchImplementation(new URL(pathname, origin), {
                redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000)
            });
            if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
            return response.json();
        }
        let reason;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const [version, readiness] = await Promise.all([read('/api/version'), read('/api/ready')]);
                if (version.commit !== commit) throw new Error('the validated commit is not live yet');
                if (readiness.ready !== true) throw new Error('D1 readiness did not pass');
                return;
            } catch (error) {
                reason = error.message;
                if (attempt + 1 < attempts) await delay(retryDelayMs);
            }
        }
        throw new Error(`Cloudflare accepted the upload, but release verification failed on ${origin} (${reason})`);
    }));
}

// The executor is injectable so release gates can be tested without contacting
// Cloudflare. Importing this module never runs a deployment.
export async function runDeployment({
    dryRun = false,
    cwd = root,
    npmCli = process.env.npm_execpath,
    run = execute,
    verify = verifyProductionRelease
} = {}) {
    if (!npmCli) throw new Error('Run this command through npm run cf:deploy (or npm run cf:deploy:dry-run).');
    const git = args => run('git', args, { cwd, capture: true });
    const assertClean = async () => {
        const status = await git(['status', '--porcelain=v1', '--untracked-files=normal']);
        if (status.trim()) throw new Error('Deployment requires a clean working tree. Commit or preserve pending changes first.');
    };

    await assertClean();
    const commit = (await git(['rev-parse', 'HEAD'])).trim();
    if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error('Could not determine a valid Git commit for this release.');

    await run(process.execPath, [npmCli, 'run', 'check'], { cwd });
    await run(process.execPath, [npmCli, 'test'], { cwd });

    await assertClean();
    if ((await git(['rev-parse', 'HEAD'])).trim() !== commit) {
        throw new Error('The Git commit changed during validation. Run deployment again for the new commit.');
    }
    const args = [path.join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'deploy', '--var', `APP_COMMIT_SHA:${commit}`];
    if (dryRun) args.push('--dry-run');
    await run(process.execPath, args, { cwd });
    if (!dryRun) await verify(commit);
    return { commit, dryRun };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    if (args.some(value => value !== '--dry-run') || args.length > 1) {
        process.stderr.write('Usage: npm run cf:deploy [-- --dry-run]\n');
        process.exitCode = 1;
    } else {
        try {
            const { commit, dryRun } = await runDeployment({ dryRun: args.includes('--dry-run') });
            process.stdout.write(`${dryRun ? 'Release dry run passed' : 'Release deployed'}: ${commit}\n`);
        } catch (error) {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        }
    }
}
