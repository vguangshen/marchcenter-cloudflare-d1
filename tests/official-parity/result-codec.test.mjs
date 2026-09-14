import assert from 'node:assert/strict';
import test from 'node:test';
import {
    OFFICIAL_FAILURE,
    OFFICIAL_SUCCESS,
    OFFICIAL_TOKEN_EXPIRED,
    decodeOfficialResult,
    wrapTrainingEntranceReturn
} from '../../server/utils/officialCompat/resultCodec.js';
import { OfficialResultParseError, OfficialResultShapeError } from '../../server/utils/officialCompat/errors.js';

for (const sample of [
    { code: OFFICIAL_SUCCESS, succ: true, message: '成功', data: { id: 1 } },
    { code: OFFICIAL_FAILURE, succ: false, message: '失败', data: null },
    { code: OFFICIAL_TOKEN_EXPIRED, succ: false, message: 'token expired', data: '' }
]) {
    test(`Result ${sample.code} preserves official semantics`, () => {
        const raw = JSON.stringify(sample);
        assert.deepEqual(decodeOfficialResult(raw), { ...sample, raw });
    });
}

test('boolean strings are distinguished and normalized', () => {
    assert.equal(decodeOfficialResult('{"code":10000,"succ":"true"}').succ, true);
    assert.equal(decodeOfficialResult('{"code":10010,"succ":"false"}').succ, false);
});

test('malformed and unknown values never become an empty array', () => {
    assert.throws(() => decodeOfficialResult('not-json'), error => {
        assert.ok(error instanceof OfficialResultParseError);
        assert.equal(error.raw, 'not-json');
        return true;
    });
    assert.throws(() => decodeOfficialResult('[]'), OfficialResultShapeError);
    assert.throws(() => decodeOfficialResult('null'), OfficialResultShapeError);
});

test('TrainingEntrance wraps every non-Result return, including null', () => {
    assert.deepEqual(wrapTrainingEntranceReturn(null), {
        code: OFFICIAL_SUCCESS,
        succ: true,
        message: '成功',
        data: null,
        raw: 'null'
    });
    assert.deepEqual(wrapTrainingEntranceReturn('ticket'), {
        code: OFFICIAL_SUCCESS,
        succ: true,
        message: '成功',
        data: 'ticket',
        raw: 'ticket'
    });
});

