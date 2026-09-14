import { OfficialSoapSchemaError } from '../../errors.js';

export function axisEscapeText(value) {
    let escaped = '';
    for (const character of String(value)) {
        const codePoint = character.codePointAt(0);
        if (codePoint > 0x7f) {
            escaped += `&#x${codePoint.toString(16).toUpperCase()};`;
        } else if (character === '&') escaped += '&amp;';
        else if (character === '<') escaped += '&lt;';
        else if (character === '>') escaped += '&gt;';
        else if (character === '"') escaped += '&quot;';
        else escaped += character;
    }
    return escaped;
}

function integerText(value, type, name) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
        if (type === 'int' && (value < -2147483648 || value > 2147483647)) {
            throw new OfficialSoapSchemaError(`${name} 超出 int 范围`);
        }
        return String(value);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
    throw new OfficialSoapSchemaError(`${name} 必须是 ${type} 整数`);
}

export function serializeScalarElement(name, value, type) {
    if (value === undefined) throw new OfficialSoapSchemaError(`缺少参数 ${name}`);
    if (value === null) {
        if (type === 'string') return '';
        throw new OfficialSoapSchemaError(`${name} 不能为 null`);
    }

    let text;
    if (type === 'string') text = String(value);
    else if (type === 'boolean') {
        if (typeof value !== 'boolean') throw new OfficialSoapSchemaError(`${name} 必须是 boolean`);
        text = value ? 'true' : 'false';
    } else if (type === 'int' || type === 'long') text = integerText(value, type, name);
    else if (type === 'decimal') {
        text = String(value);
        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
            throw new OfficialSoapSchemaError(`${name} 必须是 decimal`);
        }
    } else throw new OfficialSoapSchemaError(`不支持的标量类型 ${type}`);
    return `<${name}>${axisEscapeText(text)}</${name}>`;
}

function serializeOrderedBean(value, itemName, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new OfficialSoapSchemaError(`${itemName} 必须是对象`);
    }
    let body = '';
    for (const field of fields) {
        const fieldValue = value[field.key];
        if (fieldValue === undefined || fieldValue === null) {
            if (field.required) throw new OfficialSoapSchemaError(`${itemName}.${field.key} 不能为空`);
            continue;
        }
        body += serializeScalarElement(field.xmlName, fieldValue, field.type);
    }
    return `<${itemName}>${body}</${itemName}>`;
}

export function serializeOrderedBeanArray(parameterName, value, itemName, fields) {
    if (value === undefined) throw new OfficialSoapSchemaError(`缺少参数 ${parameterName}`);
    if (value === null) return '';
    if (!Array.isArray(value)) throw new OfficialSoapSchemaError(`${parameterName} 必须是数组或 null`);
    if (value.length === 0) return `<${parameterName}/>`;
    return `<${parameterName}>${value.map(item => serializeOrderedBean(item, itemName, fields)).join('')}</${parameterName}>`;
}

export const STU_BASEDATA_FIELDS = Object.freeze([
    { key: 'studentID', xmlName: 'StudentID', type: 'string', required: false },
    { key: 'PV', xmlName: 'PV', type: 'decimal', required: true },
    { key: 'conversion', xmlName: 'Conversion', type: 'decimal', required: true },
    { key: 'SEORelevanceScore', xmlName: 'SEORelevanceScore', type: 'decimal', required: true },
    { key: 'SJTaskFieldScore', xmlName: 'SJTaskFieldScore', type: 'decimal', required: true },
    { key: 'WSTaskFieldScore', xmlName: 'WSTaskFieldScore', type: 'decimal', required: true },
    { key: 'WLTaskFieldScore', xmlName: 'WLTaskFieldScore', type: 'decimal', required: true },
    { key: 'DZTaskFieldScore', xmlName: 'DZTaskFieldScore', type: 'decimal', required: true },
    { key: 'skillScore', xmlName: 'SkillScore', type: 'decimal', required: true }
]);

// shapan_kuajingdianshang.StuBaseDataClass, in Axis field order.
export const CROSS_BORDER_STU_BASEDATA_FIELDS = Object.freeze([
    { key: 'studentID', xmlName: 'StudentID', type: 'string', required: false },
    { key: 'SYZQY', xmlName: 'SYZQY', type: 'decimal', required: true },
    { key: 'currYear', xmlName: 'CurrYear', type: 'int', required: true },
    { key: 'currQuarter', xmlName: 'CurrQuarter', type: 'int', required: true },
    { key: 'currStepCode', xmlName: 'CurrStepCode', type: 'string', required: false },
    { key: 'userStepScore', xmlName: 'UserStepScore', type: 'decimal', required: true },
    { key: 'score', xmlName: 'Score', type: 'decimal', required: true }
]);

export const GROUP_CONTROL_TIME_FIELDS = Object.freeze([
    { key: 'groupID', xmlName: 'GroupID', type: 'string', required: false },
    { key: 'sParam', xmlName: 'sParam', type: 'string', required: false },
    { key: 'sParamName', xmlName: 'sParamName', type: 'string', required: false },
    { key: 'sValue', xmlName: 'sValue', type: 'string', required: false }
]);
