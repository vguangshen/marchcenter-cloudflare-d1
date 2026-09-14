import assert from 'node:assert/strict';
import test from 'node:test';
import { createNewTrainingAdapter } from '../../../server/utils/officialCompat/java/newTrainingAdapter.js';
import { createOfficialTokenStore } from '../../../server/utils/officialCompat/tokenStore.js';
import { buildConfirmedJavaOpenBaseUrl } from '../../../server/utils/officialCompat/officialJumpConfig.js';

const BASE = 'http://127.0.0.1:9289/DS50108';
const result = data => JSON.stringify({ code: 10000, succ: true, message: '成功', data });

test('confirmed JAVA base URL produces exactly one /open segment for all four operations', async () => {
    const urls = [];
    const fetchImplementation = async url => {
        urls.push(String(url));
        const path = new URL(url).pathname;
        const data = path.endsWith('/tokenInfo') ? 'TOKEN'
            : path.endsWith('/getLoginTeacherName') ? 'teacher-ticket'
                : path.endsWith('/trainingExamPaperV2') ? 'exam-ticket'
                    : path.endsWith('/trainingExamPaper') ? 'train-ticket'
                        : 'ready';
        return new Response(result(data), { status: 200 });
    };
    const tokenStore = createOfficialTokenStore();
    const options = {
        baseUrl: BASE,
        tokenStore,
        credentials: { tokenNum: 'LOCAL', password: 'LOCAL' },
        fetchImplementation
    };
    const adapter = createNewTrainingAdapter(options);
    assert.equal(adapter.openBaseUrl, `${BASE}/open`);
    const common = {
        loginName: 'student', className: 'class', teacherUserName: 'teacher',
        startTime: '1', endTime: '2', flag: '1', userId: '1', userName: 'name',
        startExam: false, classType: 1, maxRunYear: 0, autoDeal: false,
        roleName: '', teamName: ''
    };
    await adapter.commonReturnStudentBaseInfo({ ...common, trainOrExam: 'train' });
    await adapter.commonReturnStudentBaseInfo({ ...common, trainOrExam: 'exam' });
    await adapter.commonReturnTeacherBaseInfo({ ...common, studentList: [] });
    assert.ok(urls.includes(`${BASE}/open/tokenInfo`));
    assert.ok(urls.includes(`${BASE}/open/getUserName`));
    assert.ok(urls.includes(`${BASE}/open/trainingExamPaper`));
    assert.ok(urls.includes(`${BASE}/open/trainingExamPaperV2`));
    assert.ok(urls.includes(`${BASE}/open/getLoginTeacherName`));
    assert.ok(urls.every(url => !url.includes('/open/open/')));
});

test('base URL without trailing slash is the only confirmed JAVA form', () => {
    assert.equal(buildConfirmedJavaOpenBaseUrl(BASE), `${BASE}/open`);
});

for (const [name, value] of [
    ['trailing slash', `${BASE}/`],
    ['already contains open', `${BASE}/open`],
    ['contains query', `${BASE}?tenant=1`],
    ['complete token interface path', `${BASE}/open/tokenInfo`],
    ['complete SOAP interface path', `${BASE}/NormWebService.asmx`]
]) {
    test(`JAVA rejects ${name} without guessing or trimming`, () => {
        let fetchCalls = 0;
        assert.throws(() => createNewTrainingAdapter({
            baseUrl: value,
            tokenStore: createOfficialTokenStore(),
            credentials: { tokenNum: 'LOCAL', password: 'LOCAL' },
            fetchImplementation: async () => { fetchCalls += 1; throw new Error('must not fetch'); }
        }), { code: 'OFFICIAL_BASE_URL_UNSUPPORTED' });
        assert.equal(fetchCalls, 0);
    });
}
