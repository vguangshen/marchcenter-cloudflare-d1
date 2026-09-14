import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixtureUrl = new URL('./fixtures/axis-is-group-existed.json', import.meta.url);
const xmlUrl = new URL('./fixtures/axis-is-group-existed.xml', import.meta.url);

test('sanitized Axis fixture freezes endpoint, SOAPAction, header and XML body', async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
    const xml = (await readFile(xmlUrl, 'utf8')).trim();

    assert.equal(fixture.endpoint, 'http://127.0.0.1:18080/normwebservice.asmx?WSDL');
    assert.equal(fixture.headers.SOAPAction, '"http://tempuri.org/IsGroupExisted"');
    assert.match(fixture.soapHeader, /soapenv:mustUnderstand="0"/);
    assert.match(fixture.soapHeader, /<Uname>itmc<\/Uname><Password>itmc<\/Password>/);
    assert.match(fixture.soapBody, /<groupName>class&amp;A<\/groupName><groupID><\/groupID>/);
    assert.match(xml, /<soapenv:Header>/);
    assert.match(xml, /<soapenv:Body>/);
    assert.ok(xml.includes(fixture.soapHeader));
    assert.ok(xml.includes(fixture.soapBody));
});

