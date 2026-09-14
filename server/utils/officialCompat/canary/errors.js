export class OfficialCanaryError extends Error {
    constructor(message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = this.constructor.name;
        this.code = options.code || 'OFFICIAL_CANARY_ERROR';
        this.stage = options.stage || 'canary';
        this.status = options.status || 400;
        this.details = options.details || null;
    }
}

export class OfficialCanaryGateError extends OfficialCanaryError {
    constructor(message, options = {}) {
        super(message, { code: 'OFFICIAL_CANARY_GATE_REJECTED', stage: 'canary-gate', ...options });
    }
}

export class OfficialCanaryTargetError extends OfficialCanaryError {
    constructor(message, options = {}) {
        super(message, { code: 'OFFICIAL_CANARY_TARGET_REJECTED', stage: 'canary-network', ...options });
    }
}

export class OfficialCanarySequenceError extends OfficialCanaryError {
    constructor(message, options = {}) {
        super(message, { code: 'OFFICIAL_CANARY_SEQUENCE_REJECTED', stage: 'canary-sequence', ...options });
    }
}
