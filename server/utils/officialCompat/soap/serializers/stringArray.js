import { OfficialSoapSchemaError } from '../../errors.js';
import { axisEscapeText } from './commonTypes.js';

export function serializeStringArray(parameterName, value, itemName = 'string') {
    if (value === undefined) throw new OfficialSoapSchemaError(`缺少参数 ${parameterName}`);
    if (value === null) return '';
    if (!Array.isArray(value)) throw new OfficialSoapSchemaError(`${parameterName} 必须是数组或 null`);
    if (value.length === 0) return `<${parameterName}/>`;
    const items = value.map((item, index) => {
        if (item === undefined || item === null) {
            throw new OfficialSoapSchemaError(`${parameterName}[${index}] 不能为 null 或 undefined`);
        }
        return `<${itemName}>${axisEscapeText(String(item))}</${itemName}>`;
    }).join('');
    return `<${parameterName}>${items}</${parameterName}>`;
}

