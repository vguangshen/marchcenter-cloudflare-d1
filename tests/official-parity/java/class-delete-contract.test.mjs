import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getJavaOperation } from '../../../server/utils/officialCompat/java/operationRegistry.js';

const OFFICIAL_JAR_SHA256 = '4f71c19237e9735276fc5c97de426fb03ee09962f7af3bc4984a01df5d4ce88e';
const fixture = JSON.parse(await readFile(
    new URL('./fixtures/official-java-class-delete-captures.json', import.meta.url),
    'utf8'
));

function scenario(name) {
    const found = fixture.scenarios.find(item => item.name === name);
    assert.ok(found, `缺少官方捕获场景 ${name}`);
    return found;
}

test('official JAVA class lifecycle capture is loopback-only and redacted', () => {
    assert.equal(fixture.evidenceLevel, 'official-captured');
    assert.equal(fixture.localhostOnly, true);
    assert.equal(fixture.productionTraffic, false);
    assert.equal(fixture.artifactSha256, OFFICIAL_JAR_SHA256);
    assert.deepEqual(fixture.redactions, ['platformToken']);
    for (const captured of fixture.scenarios) {
        assert.equal(captured.evidenceLevel, 'official-captured');
        for (const call of captured.calls) {
            assert.match(call.path, /^\/open\//);
            assert.ok(call.headers.platformToken === '' || call.headers.platformToken === '[REDACTED]');
            assert.match(call.headers['Content-Type'], /application\/x-www-form-urlencoded/);
        }
    }
});

test('JAVA class delete wire: delDataByClassName deletes by class name, markGroupDeleted flags it for deferred removal', () => {
    const markGroupDeleted = scenario('mark-group-deleted');
    assert.deepEqual(markGroupDeleted.calls.map(call => call.path), [
        '/open/tokenInfo', '/open/markGroupDeleted'
    ]);
    assert.equal(markGroupDeleted.calls.at(-1).form, 'u=group-1');
    assert.match(markGroupDeleted.outcome, /"code":10000/);

    const checkClass = scenario('check-class');
    assert.deepEqual(checkClass.calls.map(call => call.path), ['/open/checkClass']);
    assert.equal(checkClass.calls.at(-1).form, 'u=class-local');
    assert.match(checkClass.outcome, /"data":"group-1"/);

    const delData = scenario('del-data-by-class-name');
    assert.deepEqual(delData.calls.map(call => call.path), ['/open/delDataByClassName']);
    assert.equal(delData.calls.at(-1).form, 'u=mcuser');
});

test('JAVA module init wire: reinitializeSystem sends an empty form to /open/reinitializeSystem', () => {
    const reinit = scenario('reinitialize-system');
    assert.deepEqual(reinit.calls.map(call => call.path), ['/open/reinitializeSystem']);
    assert.equal(reinit.calls.at(-1).form, '');
    assert.match(reinit.outcome, /"code":10000/);
});

test('JAVA operation registry freezes the class lifecycle operations as official-captured', () => {
    const checkClass = getJavaOperation('checkClass');
    assert.equal(checkClass.path, '/checkClass');
    assert.equal(checkClass.parameters[0].name, 'u');
    assert.equal(checkClass.parameters[0].required, false);
    assert.equal(checkClass.evidenceLevel, 'official-captured');

    const markGroupDeleted = getJavaOperation('markGroupDeleted');
    assert.equal(markGroupDeleted.path, '/markGroupDeleted');
    assert.equal(markGroupDeleted.parameters[0].name, 'u');
    assert.equal(markGroupDeleted.evidenceLevel, 'official-captured');

    const delDataByClassName = getJavaOperation('delDataByClassName');
    assert.equal(delDataByClassName.path, '/delDataByClassName');
    assert.equal(delDataByClassName.parameters[0].name, 'u');
    assert.equal(delDataByClassName.evidenceLevel, 'official-captured');

    const reinitializeSystem = getJavaOperation('reinitializeSystem');
    assert.equal(reinitializeSystem.path, '/reinitializeSystem');
    assert.deepEqual(reinitializeSystem.parameters, []);
    assert.equal(reinitializeSystem.evidenceLevel, 'official-captured');
});
