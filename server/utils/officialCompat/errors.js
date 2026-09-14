/**
 * Structured base error for the isolated official-compat layer.
 * The caller decides how much of `raw` may be exposed outside trusted logs.
 */
export class OfficialCompatError extends Error {
    constructor(message, options = {}) {
        super(message, options.cause ? { cause: options.cause } : undefined);
        this.name = new.target.name;
        this.code = options.code || 'OFFICIAL_COMPAT_ERROR';
        this.stage = options.stage || 'unknown';
        this.raw = options.raw ?? null;
        this.details = options.details ?? null;
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            stage: this.stage,
            message: this.message,
            raw: this.raw,
            details: this.details
        };
    }
}

export class OfficialResultParseError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_RESULT_PARSE_ERROR', stage: 'result-parse' });
    }
}

export class OfficialResultShapeError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_RESULT_SHAPE_ERROR', stage: 'result-shape' });
    }
}

export class OfficialResponseParseError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_RESPONSE_PARSE_ERROR', stage: 'operation-response' });
        this.operationName = options.operationName ?? null;
        this.dataKind = options.dataKind ?? null;
    }
}

export class OfficialAdapterParameterError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_ADAPTER_PARAMETER_ERROR', stage: 'adapter-parameters' });
    }
}

export class OfficialAdapterMethodError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code || 'OFFICIAL_ADAPTER_METHOD_NOT_ALLOWED',
            stage: 'adapter-method'
        });
    }
}

export class OfficialTicketError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_TICKET_ERROR', stage: 'ticket' });
    }
}

export class OfficialUrlBuildError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_URL_BUILD_ERROR', stage: 'jump-url' });
    }
}

export class OfficialSoapSchemaError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_SOAP_SCHEMA_ERROR', stage: 'soap-schema' });
    }
}

export class OfficialSoapEndpointError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_SOAP_ENDPOINT_UNSUPPORTED', stage: 'soap-endpoint' });
    }
}

export class OfficialSoapTransportError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_SOAP_TRANSPORT_ERROR', stage: 'soap-transport' });
    }
}

export class OfficialSoapHttpError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_SOAP_HTTP_ERROR', stage: 'soap-http' });
        this.status = options.status ?? null;
    }
}

export class OfficialSoapFaultError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_SOAP_FAULT', stage: 'soap-fault' });
        this.faultCode = options.faultCode ?? '';
        this.faultString = options.faultString ?? '';
        this.faultDetail = options.faultDetail ?? '';
    }
}

export class OfficialSoapResponseError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: options.code || 'OFFICIAL_SOAP_RESPONSE_ERROR', stage: 'soap-response' });
    }
}

export class OfficialJavaTransportError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code || 'OFFICIAL_JAVA_TRANSPORT_ERROR',
            stage: options.stage || 'java-transport'
        });
    }
}

export class OfficialJavaTimeoutError extends OfficialJavaTransportError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_JAVA_TIMEOUT', stage: 'java-timeout' });
    }
}

export class OfficialJavaHttpError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: 'OFFICIAL_JAVA_HTTP_ERROR', stage: 'java-http' });
        this.status = options.status ?? null;
    }
}

export class OfficialJavaResponseError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: options.code || 'OFFICIAL_JAVA_RESPONSE_ERROR', stage: 'java-response' });
        this.operationName = options.operationName ?? null;
    }
}

export class OfficialJavaTokenError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, { ...options, code: options.code || 'OFFICIAL_JAVA_TOKEN_ERROR', stage: 'java-token' });
    }
}

export class OfficialJumpConfigError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code || 'OFFICIAL_JUMP_CONFIG_ERROR',
            stage: options.stage || 'jump-config'
        });
        this.status = 400;
    }
}

export class OfficialJumpNotImplementedError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: 'OFFICIAL_JUMP_NOT_IMPLEMENTED',
            stage: options.stage || 'jump-selection'
        });
    }
}

export class OfficialJumpExecutionError extends OfficialCompatError {
    constructor(message, options = {}) {
        super(message, {
            ...options,
            code: options.code || 'OFFICIAL_JUMP_EXECUTION_ERROR',
            stage: options.stage || 'jump-execution'
        });
    }
}
