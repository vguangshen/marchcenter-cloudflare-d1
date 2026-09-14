import { createProductionHarness } from './helpers/productionHarness.mjs';

const ADMIN_PASSWORD = 'E2E-Admin-Password-2026!';
const harness = await createProductionHarness({ port: 4000, adminPassword: ADMIN_PASSWORD });
await harness.seedConfig({
    method: 'direct',
    serviceName: 'jump',
    allowHttp: true
}, { name: 'Direct 官方配置' });

process.stdout.write(`E2E_READY username=e2e-admin password=${ADMIN_PASSWORD}\n`);

let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await harness.dispose();
    process.exit(0);
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(() => {});
