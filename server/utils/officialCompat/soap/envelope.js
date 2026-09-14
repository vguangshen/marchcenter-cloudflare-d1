import { OfficialSoapSchemaError } from '../errors.js';
import { getSoapOperation } from './schemaRegistry.js';
import {
    axisEscapeText,
    CROSS_BORDER_STU_BASEDATA_FIELDS,
    GROUP_CONTROL_TIME_FIELDS,
    serializeOrderedBeanArray,
    serializeScalarElement,
    STU_BASEDATA_FIELDS
} from './serializers/commonTypes.js';
import { serializeStringArray } from './serializers/stringArray.js';
import { serializeStudentBaseClassArray } from './serializers/studentBaseClass.js';

export const SOAP11_CONTENT_TYPE = 'text/xml; charset=utf-8';
const ENVELOPE_PREFIX = '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';

function requireCredential(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new OfficialSoapSchemaError(`${label}不能为空`);
    }
    return axisEscapeText(value);
}

export function buildClientInfoHeader(credentials) {
    if (!credentials || typeof credentials !== 'object') {
        throw new OfficialSoapSchemaError('缺少 clientinfo 凭据');
    }
    const username = requireCredential(credentials.username, 'SOAP 用户名');
    const password = requireCredential(credentials.password, 'SOAP 密码');
    return `<clientinfo soapenv:mustUnderstand="0" xmlns="http://tempuri.org/"><Uname>${username}</Uname><Password>${password}</Password></clientinfo>`;
}

function serializeParameter(parameter, value) {
    if (parameter.type === 'ArrayOfString') {
        return serializeStringArray(parameter.name, value, parameter.itemName);
    }
    if (parameter.type === 'ArrayOfStudentBaseClass') {
        return serializeStudentBaseClassArray(parameter.name, value, parameter.itemName);
    }
    if (parameter.type === 'ArrayOfStuBasedataClass') {
        return serializeOrderedBeanArray(parameter.name, value, parameter.itemName, STU_BASEDATA_FIELDS);
    }
    if (parameter.type === 'ArrayOfStuBaseDataClass') {
        return serializeOrderedBeanArray(parameter.name, value, parameter.itemName, CROSS_BORDER_STU_BASEDATA_FIELDS);
    }
    if (parameter.type === 'ArrayOfGroupControlTime') {
        return serializeOrderedBeanArray(parameter.name, value, parameter.itemName, GROUP_CONTROL_TIME_FIELDS);
    }
    return serializeScalarElement(parameter.name, value, parameter.type);
}

export function buildSoapEnvelope({ profileName, operationName, parameters = {}, credentials }) {
    const operation = getSoapOperation(profileName, operationName);
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        throw new OfficialSoapSchemaError('SOAP 参数必须是对象');
    }
    let operationBody = '';
    for (const parameter of operation.parameters) {
        if (!Object.prototype.hasOwnProperty.call(parameters, parameter.name)) {
            throw new OfficialSoapSchemaError(`缺少参数 ${parameter.name}`);
        }
        operationBody += serializeParameter(parameter, parameters[parameter.name]);
    }
    const operationXml = operationBody
        ? `<${operation.operationName} xmlns="http://tempuri.org/">${operationBody}</${operation.operationName}>`
        : `<${operation.operationName} xmlns="http://tempuri.org/"/>`;
    return `${ENVELOPE_PREFIX}<soapenv:Header>${buildClientInfoHeader(credentials)}</soapenv:Header><soapenv:Body>${operationXml}</soapenv:Body></soapenv:Envelope>`;
}

export function buildSoapActionHeader(operation) {
    return `"${operation.soapAction}"`;
}
