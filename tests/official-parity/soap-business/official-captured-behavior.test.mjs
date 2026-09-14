import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fixtureUrl = new URL('./fixtures/official-business-captures.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

function scenario(name) {
    const found = fixture.scenarios.find(item => item.name === name);
    assert.ok(found, `缺少 official-captured 场景 ${name}`);
    return found;
}

function operations(name) {
    return scenario(name).calls.map(call => call.operationName);
}

function request(name, operationName) {
    const call = scenario(name).calls.find(item => item.operationName === operationName);
    assert.ok(call, `${name} 缺少 ${operationName} 请求`);
    return call.requestXml;
}

test('official JAR capture is loopback-only, redacted and complete', () => {
    assert.equal(fixture.evidenceLevel, 'official-captured');
    assert.equal(fixture.localhostOnly, true);
    assert.equal(fixture.productionTraffic, false);
    assert.equal(fixture.scenarioCount, 52);
    assert.equal(fixture.scenarios.length, 52);
    assert.equal(fixture.scenarios.reduce((sum, item) => sum + item.calls.length, 0), 125);
    for (const item of fixture.scenarios) {
        assert.equal(item.evidenceLevel, 'official-captured');
        for (const call of item.calls) {
            assert.match(call.endpoint, /^http:\/\/127\.0\.0\.1:\d+\//);
            assert.equal(call.fallbackResponse, false);
            const header = call.requestXml.match(/<soapenv:Header>([\s\S]*?)<\/soapenv:Header>/)?.[1];
            assert.ok(header, `${item.name}/${call.operationName} 缺少 SOAP Header`);
            assert.match(header, /<Uname>\[REDACTED\]<\/Uname>/);
            assert.match(header, /<Password>\[REDACTED\]<\/Password>/);
        }
    }
});

test('captured failure branches preserve the official continuation order', () => {
    assert.deepEqual(operations('group-existence-code-failure'), [
        'IsGroupExisted', 'AddTrainGroup', 'IsStuExisted'
    ]);
    assert.equal(scenario('group-existence-code-failure').outcome.ticketGenerated, true);
    assert.deepEqual(operations('add-teacher-code-failure'), [
        'IsGroupExisted', 'IsTeacherExisted', 'AddTeacher', 'IsStuExisted', 'AddStudent'
    ]);
    assert.equal(scenario('add-teacher-code-failure').outcome.ticketGenerated, true);
});

test('captured AddStudent data shapes control ticket generation exactly as official JAR', () => {
    for (const name of ['add-student-partial-success', 'add-student-empty-success']) {
        assert.equal(scenario(name).outcome.type, 'return');
        assert.equal(scenario(name).outcome.ticketGenerated, true);
    }
    for (const name of [
        'add-student-null-data',
        'add-student-missing-data',
        'add-student-invalid-json-data'
    ]) {
        assert.equal(scenario(name).outcome.type, 'exception');
        assert.equal(scenario(name).outcome.ticketGenerated, false);
    }
});

test('captured existence result variants distinguish failures, malformed data and coercible arrays', () => {
    for (const prefix of ['stu', 'teacher']) {
        assert.equal(scenario(`${prefix}-existence-code-failure`).outcome.type, 'return');
        assert.match(scenario(`${prefix}-existence-code-failure`).outcome.raw, /"code":10010/);
        for (const suffix of ['null-data', 'empty-data', 'missing-data', 'single-string', 'object-data']) {
            assert.equal(scenario(`${prefix}-existence-${suffix}`).outcome.type, 'exception');
        }
        assert.equal(scenario(`${prefix}-existence-non-string-array`).outcome.type, 'return');
        assert.equal(scenario(`${prefix}-existence-non-string-array`).outcome.ticketGenerated, true);
    }
});

test('captured classType dispatch uses int values and falls through to training group', () => {
    const expected = new Map([
        ['class-type-null', 'AddTrainGroup'],
        ['class-type-missing', 'AddTrainGroup'],
        ['class-type-zero', 'AddTrainGroup'],
        ['class-type-one', 'AddTrainGroup'],
        ['class-type-two', 'AddAppraisalGroup'],
        ['class-type-three', 'AddMegagameGroup'],
        ['class-type-four', 'AddTrainGroup']
    ]);
    for (const [name, operationName] of expected) assert.equal(operations(name)[1], operationName);
    for (const name of [
        'class-type-string-one', 'class-type-string-two',
        'class-type-string-three', 'class-type-string-invalid'
    ]) {
        assert.deepEqual(operations(name), []);
        assert.equal(scenario(name).outcome.exceptionChain[0].class, 'java.lang.IllegalArgumentException');
    }
});

test('captured maxRunYear branches preserve null, zero and runtime type behavior', () => {
    for (const name of ['marketing-max-run-year-null', 'marketing-max-run-year-missing']) {
        assert.deepEqual(operations(name), ['IsGroupExisted', 'IsStuExisted']);
        assert.equal(scenario(name).outcome.type, 'exception');
    }
    for (const name of ['marketing-max-run-year-string-zero', 'marketing-max-run-year-string-invalid']) {
        assert.deepEqual(operations(name), []);
    }
    for (const name of ['commerce-max-run-year-null', 'commerce-max-run-year-missing']) {
        const xml = request(name, 'AddStudent');
        assert.match(xml, /<maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
    }
    for (const name of ['commerce-max-run-year-string-zero', 'commerce-max-run-year-string-invalid']) {
        assert.deepEqual(operations(name), []);
    }

    const marketingXml = request('marketing-max-run-year-zero', 'AddStudent');
    assert.match(marketingXml, /<maxRunYear>0<\/maxRunYear><autoDeal>false<\/autoDeal>/);
});

test('captured removeAll semantics preserve order and remove all duplicate existing accounts', () => {
    const partialXml = request('duplicate-students-existing-a', 'AddStudent');
    assert.doesNotMatch(partialXml, /<StudentID>a<\/StudentID>/);
    assert.match(partialXml, /<StudentID>b<\/StudentID>/);
    assert.deepEqual(operations('duplicate-students-all-existing'), [
        'IsGroupExisted', 'IsTeacherExisted', 'IsStuExisted'
    ]);
});

test('captured group creation data shapes control account-check continuation', () => {
    for (const name of ['group-creation-data-null', 'group-creation-data-missing']) {
        assert.deepEqual(operations(name), ['IsGroupExisted', 'AddTrainGroup']);
        assert.equal(scenario(name).outcome.type, 'exception');
    }
    for (const name of ['group-creation-data-empty', 'group-creation-data-object']) {
        assert.deepEqual(operations(name), ['IsGroupExisted', 'AddTrainGroup', 'IsStuExisted']);
    }
    const objectXml = request('group-creation-object-used-by-add-student', 'AddStudent');
    assert.match(objectXml, /<groupID>\{&quot;id&quot;:&quot;group-object&quot;\}<\/groupID>/);
});

test('official Axis capture keeps Java long maximum byte-for-byte in AddStudent XML', () => {
    const xml = request('java-long-maximum-wire-values', 'AddStudent');
    assert.match(xml, /<Password>train_1239223372036854775807<\/Password>/);
    assert.match(xml, /<st>9223372036854775807<\/st>/);
    assert.match(xml, /<ed>9223372036854775807<\/ed>/);
    assert.doesNotMatch(xml, /9223372036854776000/);
});
