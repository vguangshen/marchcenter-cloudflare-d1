export const TEMPURI_NAMESPACE = 'http://tempuri.org/';

const ARRAY_ITEM_NAMES = Object.freeze({
    ArrayOfString: 'string',
    ArrayOfStudentBaseClass: 'StudentBaseClass',
    ArrayOfStuBasedataClass: 'StuBasedataClass',
    ArrayOfStuBaseDataClass: 'StuBaseDataClass',
    ArrayOfGroupControlTime: 'GroupControlTime'
});

export function defineProfile(profileName, definitions) {
    const operations = definitions.map(([operationName, parameterTuples = []]) => Object.freeze({
        operationName,
        soapAction: `${TEMPURI_NAMESPACE}${operationName}`,
        parameters: Object.freeze(parameterTuples.map(([name, type]) => Object.freeze({
            name,
            type,
            itemName: ARRAY_ITEM_NAMES[type] || null
        }))),
        returnNodeName: `${operationName}Result`
    }));
    return Object.freeze({ profileName, operations: Object.freeze(operations) });
}
