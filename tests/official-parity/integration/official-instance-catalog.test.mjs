import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    OFFICIAL_INSTANCE_CATALOG,
    getDefaultOfficialInstanceVariant,
    getOfficialInstanceFamily,
    resolveOfficialInstance
} from '../../../server/utils/officialCompat/instanceCatalog.js';
import { OfficialJumpNotImplementedError } from '../../../server/utils/officialCompat/errors.js';
import { validateOfficialJumpConfiguration } from '../../../server/utils/officialCompat/officialJumpPreflight.js';

test('every public method resolves to exactly one internal official profile', () => {
    const expected = {
        java: ['java-new-rest', undefined],
        net: ['net-new-soap', 37],
        marketing: ['marketing-new-soap', 42],
        commerce: ['commerce-new-soap', 42],
        managementAccounting: ['management-accounting-new-soap', 41],
        crossBorderCommerce: ['cross-border-new-soap', 28],
        enterpriseManagement: ['enterprise-management-new-soap', 41],
        direct: ['direct-url', undefined]
    };
    assert.deepEqual(Object.keys(OFFICIAL_INSTANCE_CATALOG).sort(), Object.keys(expected).sort());
    for (const [method, [profileId, operationCount]] of Object.entries(expected)) {
        const family = getOfficialInstanceFamily(method);
        const selected = resolveOfficialInstance({ method });
        assert.equal(getDefaultOfficialInstanceVariant(method), profileId);
        assert.equal(family.defaultVariant, profileId);
        assert.equal(family.variants.length, 1);
        assert.equal(family.variants[0], selected);
        assert.equal(selected.id, profileId);
        if (operationCount !== undefined) assert.equal(selected.operationCount, operationCount);
    }
});

test('profile resolution is determined only by the selected method', () => {
    const config = { method: 'java' };
    Object.defineProperty(config, 'instanceVariant', {
        get() { throw new Error('instanceVariant must not be read'); }
    });
    assert.equal(resolveOfficialInstance(config), OFFICIAL_INSTANCE_CATALOG.java);
});

test('unknown methods fail instead of selecting another profile', () => {
    assert.throws(
        () => resolveOfficialInstance({ method: 'unknown' }),
        error => error instanceof OfficialJumpNotImplementedError
    );
});

test('preflight reports the fixed internal profile without requiring a variant input', () => {
    const report = validateOfficialJumpConfiguration({
        officialBaseUrlConfirmed: true,
        method: 'net',
        officialBaseUrl: 'https://example.invalid/NET',
        loginRole: 'student',
        loginName: 'student-1',
        className: 'class-1',
        teacherUserName: 'teacher-1',
        userId: '9223372036854775807',
        userName: 'Student'
    });
    assert.equal(report.instanceVariant, 'net-new-soap');
    assert.equal(report.instanceLabel, '.NET 通用新版 SOAP');
});

test('card and SSO settings UI expose no duplicate mode or instance selector', async () => {
    const modal = await readFile(new URL('../../../src/components/modals/EditModal.jsx', import.meta.url), 'utf8');
    const manager = await readFile(new URL('../../../src/components/views/settings/SsoManager.jsx', import.meta.url), 'utf8');
    const source = `${modal}\n${manager}`;
    assert.doesNotMatch(source, /目标系统实例|当前系统实例|官方系统实例变体|适配模式/);
    assert.doesNotMatch(source, /getOfficialInstanceDescriptor/);
    assert.doesNotMatch(source, /�|锟斤拷/);
    assert.doesNotMatch(manager, /config\.officialBaseUrl/);
});
