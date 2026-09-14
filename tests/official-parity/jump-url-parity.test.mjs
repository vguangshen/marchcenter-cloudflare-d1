import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildDirectJumpUrl,
    buildJavaJumpUrl,
    buildJavaTeacherJumpUrl,
    buildSoapJumpUrl
} from '../../server/utils/officialCompat/jumpUrlBuilder.js';

test('direct returns the source URL unchanged', () => {
    const source = 'http://sandbox.invalid/path/?x=1#fragment';
    assert.equal(buildDirectJumpUrl(source), source);
});

test('JAVA appends the official enterIndex path and raw result query fragment', () => {
    assert.equal(
        buildJavaJumpUrl('https://sandbox.invalid/DS01', 'u=A%2BB%2F%E4%B8%AD'),
        'https://sandbox.invalid/DS01/open/enterIndex?u=A%2BB%2F%E4%B8%AD'
    );
});

test('JAVA preserves the official contains-question-mark separator rule', () => {
    assert.equal(
        buildJavaJumpUrl('https://sandbox.invalid/base?tenant=1', 'u=ticket'),
        'https://sandbox.invalid/base?tenant=1/open/enterIndex&u=ticket'
    );
});

test('JAVA teacher uses the official teacherIndex entry and fixed theory-score flag', () => {
    assert.equal(
        buildJavaTeacherJumpUrl(
            'https://sandbox.invalid/DS01',
            'teacherUserName=T%2BICKET&className=班级&classMode=1'
        ),
        'https://sandbox.invalid/DS01/open/teacherIndex?needTheoryScore=1&teacherUserName=T%2BICKET&className=班级&classMode=1'
    );
});

test('SOAP appends Login.aspx without re-encoding the hexadecimal ticket', () => {
    assert.equal(
        buildSoapJumpUrl('https://sandbox.invalid/DS50108', 'ABCDEF0123456789'),
        'https://sandbox.invalid/DS50108/Login.aspx?type=itmc&data=ABCDEF0123456789'
    );
});

test('SOAP teacher entry appends the official theory-score flag', () => {
    assert.equal(
        buildSoapJumpUrl('https://sandbox.invalid/DS50108', 'ABCDEF0123456789', 'itmc', {
            includeNeedTheoryScore: true
        }),
        'https://sandbox.invalid/DS50108/Login.aspx?type=itmc&data=ABCDEF0123456789&needTheoryScore=1'
    );
});
