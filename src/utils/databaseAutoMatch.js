export function platformIdentity(value) {
    try {
        const url = new URL(String(value || '').trim());
        const path = decodeURIComponent(url.pathname || '');
        const code = path.match(/(?:^|\/)([A-Za-z]{2,8}\d{3,})(?:\/|$)/)?.[1]?.toUpperCase() || '';
        return { hostname: url.hostname.toLowerCase(), code };
    } catch {
        return { hostname: '', code: '' };
    }
}

export function matchAccountApiService(platformUrl, services = []) {
    const identity = platformIdentity(platformUrl);
    if (!identity.hostname) return null;
    const enabled = services.filter(service => service?.enabled && service?.endpointUrl);
    const exactHost = enabled.filter(service => {
        try { return new URL(service.endpointUrl).hostname.toLowerCase() === identity.hostname; }
        catch { return false; }
    });
    return exactHost.length === 1 ? exactHost[0] : null;
}

export function matchPlatformDatabase(platformUrl, databases = []) {
    const { code } = platformIdentity(platformUrl);
    if (!code) return null;
    const normalizedCode = code.replace(/[^A-Z0-9]/g, '');
    const matches = databases.filter(name => String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').includes(normalizedCode));
    return matches.length === 1 ? matches[0] : null;
}
