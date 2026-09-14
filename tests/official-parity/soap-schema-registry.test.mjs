import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildConfirmedAxisEndpoint,
    getSoapOperation,
    listSoapProfiles
} from '../../server/utils/officialCompat/soap/schemaRegistry.js';
import { OfficialSoapEndpointError } from '../../server/utils/officialCompat/errors.js';

test('all six new SOAP profiles freeze their official operations', () => {
    const counts = Object.fromEntries(listSoapProfiles().map(profile => [profile.profileName, profile.operations.length]));
    assert.deepEqual(counts, {
        net: 37,
        marketing: 42,
        commerce: 42,
        managementAccounting: 41,
        crossBorderCommerce: 28,
        enterpriseManagement: 41
    });
    for (const profile of listSoapProfiles()) {
        for (const operation of profile.operations) {
            assert.equal(operation.soapAction, `http://tempuri.org/${operation.operationName}`);
            assert.equal(operation.returnNodeName, `${operation.operationName}Result`);
            assert.ok(Array.isArray(operation.parameters));
            for (const parameter of operation.parameters) {
                assert.equal(typeof parameter.name, 'string');
                assert.equal(typeof parameter.type, 'string');
                if (parameter.type.startsWith('ArrayOf')) assert.equal(typeof parameter.itemName, 'string');
                else assert.equal(parameter.itemName, null);
            }
        }
    }
});

test('commerce BeginMediaAd preserves the official GroupID capitalization', () => {
    const operation = getSoapOperation('commerce', 'BeginMediaAd');
    assert.deepEqual(operation.parameters.map(parameter => parameter.name), ['GroupID', 'ntime']);
});

test('the three AddStudent contracts remain profile-specific', () => {
    const signature = profileName => getSoapOperation(profileName, 'AddStudent')
        .parameters.map(({ name, type }) => [name, type]);
    assert.deepEqual(signature('net'), [
        ['studentList', 'ArrayOfStudentBaseClass'], ['groupID', 'string'],
        ['st', 'long'], ['ed', 'long'], ['startExam', 'boolean']
    ]);
    assert.deepEqual(signature('marketing'), [
        ['studentList', 'ArrayOfStudentBaseClass'], ['groupID', 'string'],
        ['st', 'long'], ['ed', 'long'], ['maxRunYear', 'int'], ['autoDeal', 'boolean']
    ]);
    assert.deepEqual(signature('commerce'), [
        ['studentList', 'ArrayOfStudentBaseClass'], ['groupID', 'string'],
        ['st', 'long'], ['ed', 'long'], ['maxRunYear', 'int'], ['autoDeal', 'boolean']
    ]);
    assert.deepEqual(signature('managementAccounting'), signature('commerce'));
    assert.deepEqual(signature('enterpriseManagement'), signature('commerce'));
    assert.deepEqual(signature('crossBorderCommerce'), signature('net'));
});

test('new profiles preserve official operation differences and exact GroupID casing', () => {
    assert.deepEqual(
        getSoapOperation('crossBorderCommerce', 'AddGroup').parameters.map(item => item.name),
        ['groupName']
    );
    assert.throws(() => getSoapOperation('crossBorderCommerce', 'AddTrainGroup'));
    assert.deepEqual(
        getSoapOperation('managementAccounting', 'ContestOrdersAd').parameters.map(item => item.name),
        ['groupID', 'ntime']
    );
    assert.deepEqual(
        getSoapOperation('enterpriseManagement', 'ContestOrdersAd').parameters.map(item => item.name),
        ['GroupID', 'ntime']
    );
});

test('only confirmed base URL input is converted to the Axis endpoint', () => {
    assert.equal(
        buildConfirmedAxisEndpoint('https://sandbox.invalid/DS01'),
        'https://sandbox.invalid/DS01/normwebservice.asmx?WSDL'
    );
    for (const unsupported of [
        'https://sandbox.invalid/DS01/NormWebService.asmx',
        'https://sandbox.invalid/DS01/normwebservice.asmx?WSDL',
        'https://sandbox.invalid/DS01/',
        'https://sandbox.invalid/DS01?tenant=1'
    ]) {
        assert.throws(() => buildConfirmedAxisEndpoint(unsupported), OfficialSoapEndpointError);
    }
});
