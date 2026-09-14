import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    mapCardAddressToOfficialConfig,
    validateOfficialCardAddress
} from '../../../server/utils/officialCompat/cardAddress.js';
import { createOfficialSafeFetch } from '../../../server/utils/officialCompat/safeTransport.js';
import { buildConfirmedJavaOpenBaseUrl } from '../../../server/utils/officialCompat/officialJumpConfig.js';
import { selectOfficialBaseUrl } from '../../../server/utils/officialCompat/officialJumpConfig.js';
import { createJavaHttpTransport } from '../../../server/utils/officialCompat/java/javaHttpTransport.js';
import { buildConfirmedAxisEndpoint } from '../../../server/utils/officialCompat/soap/schemaRegistry.js';
import {
    buildDirectJumpUrl,
    buildJavaJumpUrl,
    buildJavaTeacherJumpUrl,
    buildSoapJumpUrl
} from '../../../server/utils/officialCompat/jumpUrlBuilder.js';

const JAVA_BASE = 'http://8.138.27.219:8872/DS50109';
const SOAP_BASE = 'http://8.138.27.219:8872/YX030105';

test('JAVA card jump link is the request-scoped officialBaseUrl without trimming', () => {
    const stored = { method: 'java', officialBaseUrl: 'https://stale.invalid/OLD' };
    const mapped = mapCardAddressToOfficialConfig(stored, JAVA_BASE);
    assert.equal(mapped.officialBaseUrl, JAVA_BASE);
    assert.equal(mapped.officialBaseUrlConfirmed, true);
    assert.equal(stored.officialBaseUrl, 'https://stale.invalid/OLD');
    assert.equal(selectOfficialBaseUrl(stored, { cardUrl: JAVA_BASE }), JAVA_BASE);
});

test('SOAP card jump link is a strict project root and full WSDL is rejected', () => {
    assert.equal(mapCardAddressToOfficialConfig({ method: 'marketing' }, SOAP_BASE).officialBaseUrl, SOAP_BASE);
    assert.throws(
        () => validateOfficialCardAddress('net', `${SOAP_BASE}/NormWebService.asmx?WSDL`),
        /officialBaseUrl|尾斜杠|WSDL/
    );
});

test('direct card address remains byte-for-byte unchanged including query', () => {
    const target = 'https://example.invalid/final?from=card#section';
    const mapped = mapCardAddressToOfficialConfig({ method: 'direct' }, target);
    assert.equal(mapped.officialBaseUrl, target);
    assert.equal(buildDirectJumpUrl(mapped.officialBaseUrl), target);
});

test('DS50109 JAVA operations contain exactly one open segment', async () => {
    const urls = [];
    const transport = createJavaHttpTransport({
        fetchImplementation: async input => {
            urls.push(String(input));
            return new Response('{"code":10000,"succ":true,"message":"成功","data":"ok"}');
        }
    });
    const openBaseUrl = buildConfirmedJavaOpenBaseUrl(JAVA_BASE);
    for (const operationName of ['tokenInfo', 'getUserName', 'trainingExamPaper', 'trainingExamPaperV2']) {
        await transport.post({ openBaseUrl, operationName, platformToken: 'redacted', values: {} });
    }
    assert.deepEqual(urls, [
        `${JAVA_BASE}/open/tokenInfo`,
        `${JAVA_BASE}/open/getUserName`,
        `${JAVA_BASE}/open/trainingExamPaper`,
        `${JAVA_BASE}/open/trainingExamPaperV2`
    ]);
    assert.equal(urls.some(url => url.includes('/open/open/')), false);
});

test('final JAVA and SOAP URLs are built from the card root, never the root alone', () => {
    assert.equal(buildJavaJumpUrl(JAVA_BASE, 'u=abc%2Bdef'), `${JAVA_BASE}/open/enterIndex?u=abc%2Bdef`);
    assert.equal(
        buildJavaTeacherJumpUrl(JAVA_BASE, 'teacherUserName=abc%2Bdef&className=mc-user&classMode=1'),
        `${JAVA_BASE}/open/teacherIndex?needTheoryScore=1&teacherUserName=abc%2Bdef&className=mc-user&classMode=1`
    );
    assert.equal(buildConfirmedAxisEndpoint(SOAP_BASE), `${SOAP_BASE}/normwebservice.asmx?WSDL`);
    assert.equal(buildSoapJumpUrl(SOAP_BASE, 'AABBCC'), `${SOAP_BASE}/Login.aspx?type=itmc&data=AABBCC`);
    assert.equal(
        buildSoapJumpUrl(SOAP_BASE, 'AABBCC', 'itmc', { includeNeedTheoryScore: true }),
        `${SOAP_BASE}/Login.aspx?type=itmc&data=AABBCC&needTheoryScore=1`
    );
});

test('safe official transport enforces exact host port context, bounded request options, and rejects redirects', async () => {
    const calls = [];
    const fetchImplementation = async (url, options) => {
        calls.push({ url, options });
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const safeFetch = createOfficialSafeFetch({
        baseUrl: JAVA_BASE,
        allowHttp: true,
        timeoutMs: 1234,
        maxResponseBytes: 5678,
        fetchImplementation
    });
    await safeFetch(`${JAVA_BASE}/open/tokenInfo`, { method: 'POST', body: '' });
    assert.equal(calls[0].url, `${JAVA_BASE}/open/tokenInfo`);
    assert.equal(calls[0].options.redirect, 'manual');
    await assert.rejects(() => safeFetch('http://8.138.27.220:8872/DS50109/open/tokenInfo'), /精确目标边界/);
    await assert.rejects(() => safeFetch('http://8.138.27.219:8873/DS50109/open/tokenInfo'), /精确目标边界/);
    await assert.rejects(() => safeFetch('http://8.138.27.219:8872/OTHER/open/tokenInfo'), /精确目标边界/);
    await assert.rejects(() => safeFetch(`${JAVA_BASE}/open/tokenInfo`, { headers: { Host: 'evil.invalid' } }), /Host/);

    const redirecting = createOfficialSafeFetch({
        baseUrl: JAVA_BASE,
        allowHttp: true,
        fetchImplementation: async () => new Response('', { status: 302, headers: { location: 'http://evil.invalid/' } })
    });
    await assert.rejects(() => redirecting(`${JAVA_BASE}/open/tokenInfo`), /重定向/);
});

test('production official transport uses bounded raw HTTP for IP literal high ports', async () => {
    const calls = [];
    const safeFetch = createOfficialSafeFetch({
        baseUrl: SOAP_BASE,
        allowHttp: true,
        timeoutMs: 4321,
        maxResponseBytes: 8765,
        rawHttpImplementation: async (url, options) => {
            calls.push({ url, options });
            return {
                status: 200,
                statusText: 'OK',
                ok: true,
                headers: { 'content-type': 'text/xml; charset=utf-8', connection: 'close' },
                data: '<Result />'
            };
        }
    });

    const response = await safeFetch(`${SOAP_BASE}/normwebservice.asmx?WSDL`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"http://tempuri.org/IsGroupExisted"' },
        body: '<soap />'
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<Result />');
    assert.deepEqual(calls, [{
        url: `${SOAP_BASE}/normwebservice.asmx?WSDL`,
        options: {
            method: 'POST',
            headers: {
                'content-type': 'text/xml; charset=utf-8',
                soapaction: '"http://tempuri.org/IsGroupExisted"'
            },
            body: '<soap />',
            timeoutMs: 4321,
            maxResponseBytes: 8765
        }
    }]);
    assert.equal(response.headers.has('connection'), false);
});

test('UI has one visible address input and navigates only with backend redirectUrl', async () => {
    const modal = await readFile(new URL('../../../src/components/modals/EditModal.jsx', import.meta.url), 'utf8');
    const manager = await readFile(new URL('../../../src/components/views/settings/SsoManager.jsx', import.meta.url), 'utf8');
    const actions = await readFile(new URL('../../../src/hooks/useCompetitionActions.js', import.meta.url), 'utf8');
    assert.match(modal, /跳转链接 \/ 编排接口地址/);
    assert.match(modal, /填写被跳转系统的项目根地址/);
    assert.doesNotMatch(manager, /<input value=\{config\.officialBaseUrl/);
    assert.doesNotMatch(manager, />官方基础地址</);
    assert.doesNotMatch(manager, />平台地址</);
    assert.match(manager, /地址来自竞赛卡片/);
    assert.doesNotMatch(manager, /显示已保存凭据/);
    assert.match(manager, /aria-label=\{revealed \? `隐藏\$\{label\}` : `显示\$\{label\}`\}/);
    assert.match(manager, /onToggleVisibility=\{toggleSecretVisibility\}/);
    assert.match(manager, /reveal-secrets/);
    assert.doesNotMatch(modal, /目标系统实例|官方系统实例变体|适配模式/);
    assert.doesNotMatch(manager, /当前系统实例|目标系统实例|官方系统实例变体|适配模式/);
    assert.doesNotMatch(`${modal}\n${manager}`, /�|锟斤拷/);
    assert.match(manager, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
    assert.match(manager, /sm:grid-cols-2 sm:p-4/);
    assert.doesNotMatch(manager, /md:grid-cols-2 xl:grid-cols-4/);
    assert.match(actions, /window\.open\('about:blank', '_blank'\)/);
    assert.match(actions, /opened\.location\.replace\(url\)/);
    assert.doesNotMatch(actions, /window\.location\.assign\(data\.redirectUrl\)/);
});

test('competition save auto-binds the sole method config and validates the card address', async () => {
    const source = await readFile(new URL('../../../server/routes/competitions.js', import.meta.url), 'utf8');
    assert.match(source, /persistOfficialCardAddress/);
    assert.match(source, /candidate\.method === method/);
    assert.match(source, /validateOfficialCardAddress\(method, data\.url\)/);
    assert.doesNotMatch(source, /resolveAdapterMode|adapterMode|instanceVariant/);
});

test('production Worker does not expose the canary runner route', async () => {
    const worker = await readFile(new URL('../../../worker/index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(worker, /officialCanaryRoutes|official-canary|canaryRunner/);
});
