import { isIpAddress } from './targetPolicy.js';

/** Called only after the execution gate has passed; preflight never invokes DNS. */
export async function resolveCanaryHostname(hostname) {
    const normalized = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (isIpAddress(normalized)) return [normalized];
    const dns = await import('node:dns');
    const [ipv4, ipv6] = await Promise.all([
        dns.promises.resolve4(normalized).catch(() => []),
        dns.promises.resolve6(normalized).catch(() => [])
    ]);
    return [...new Set([...ipv4, ...ipv6].map(value => String(value).toLowerCase()))];
}
