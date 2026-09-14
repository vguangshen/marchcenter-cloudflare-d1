const SECRET_KEY = /password|token|ticket|authorization|header|body|raw|credential|redirecturl|clientinfo/i;

function redactText(value, secretValues) {
    let text = String(value);
    for (const secret of secretValues) {
        if (secret) text = text.split(String(secret)).join('[REDACTED]');
    }
    return text
        .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[REDACTED_AUTH]')
        .replace(/platformToken\s*[:=]\s*[^\s,;]+/gi, 'platformToken=[REDACTED]')
        .replace(/([?&]u=)[^&\s]+/gi, '$1[REDACTED]');
}

function sanitize(value, secretValues, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return redactText(value, secretValues);
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => sanitize(item, secretValues, seen));
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) continue;
        output[key] = sanitize(item, secretValues, seen);
    }
    return output;
}

export function createMemoryCanaryAuditSink() {
    const records = [];
    return Object.freeze({
        append: async record => { records.push(structuredClone(record)); },
        records
    });
}

export function createCanaryAuditRecorder(options = {}) {
    if (!options.sink || typeof options.sink.append !== 'function') throw new TypeError('canary audit sink 必须显式注入');
    const clock = options.clock || (() => Date.now());
    const secretValues = Array.isArray(options.secretValues) ? options.secretValues : [];
    return Object.freeze({
        async record(event, details = {}) {
            const safe = sanitize(details, secretValues);
            await options.sink.append(Object.freeze({
                timestamp: new Date(clock()).toISOString(),
                event,
                ...safe
            }));
        }
    });
}
