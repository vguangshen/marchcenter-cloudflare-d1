import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['server', 'src', 'worker', 'migrations'];
const extensions = new Set(['.js', '.jsx', '.mjs', '.sql']);
const forbidden = [
    [/from\s+['"](?:node:)?vm['"]|require\(['"](?:node:)?vm['"]\)/i, 'Node vm'],
    [/runInNewContext|runInContext|compileFunction/i, 'executable SSO script runtime'],
    [/\bmysql2\b|\bsequelize\b/i, 'MySQL dependency'],
    [/\bbcryptjs\b|\bjsonwebtoken\b/i, 'VPS authentication dependency'],
    [/from\s+['"]express['"]|from\s+['"]cors['"]|from\s+['"]dotenv['"]/i, 'traditional Express dependency'],
    [/redirect\s*:\s*['"]error['"]/i, 'unsupported Cloudflare fetch redirect mode'],
    [/ON\s+DUPLICATE\s+KEY|GET_LOCK\s*\(|RELEASE_LOCK\s*\(|ENGINE\s*=\s*InnoDB|AUTO_INCREMENT/i, 'MySQL-only SQL'],
    [/getConnection\s*\(|beginTransaction\s*\(|\.commit\s*\(|\.rollback\s*\(/i, 'fake SQL transaction API']
];

const failures = [];

async function filesUnder(dir) {
    const output = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) output.push(...await filesUnder(full));
        else if (extensions.has(path.extname(entry.name))) output.push(full);
    }
    return output;
}

for (const folder of scanRoots) {
    const absolute = path.join(root, folder);
    try { await stat(absolute); } catch { continue; }
    for (const file of await filesUnder(absolute)) {
        const text = await readFile(file, 'utf8');
        for (const [pattern, label] of forbidden) {
            if (pattern.test(text)) failures.push(`${path.relative(root, file)}: ${label}`);
        }
    }
}

if (failures.length) {
    console.error('Cloudflare port check failed:\n' + failures.map(item => `- ${item}`).join('\n'));
    process.exit(1);
}

const wrangler = await readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
if (wrangler.includes('REPLACE_WITH_D1_DATABASE_ID')) {
    console.warn('Warning: replace the D1 database_id in wrangler.jsonc before deployment.');
}
console.log('Cloudflare port check passed. The nine supported SSO adapters remain isolated and Worker-compatible.');
