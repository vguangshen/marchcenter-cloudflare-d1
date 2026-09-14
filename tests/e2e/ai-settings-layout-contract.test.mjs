import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AI parameter fields share one aligned grid and model discovery lives in the section header', async () => {
    const source = await readFile(new URL('../../src/components/views/settings/ApiEngine.jsx', import.meta.url), 'utf8');
    const sectionStart = source.indexOf('{activeProvider.name} 参数配置');
    const gridStart = source.indexOf('grid grid-cols-1 items-start', sectionStart);
    const baseLabel = source.indexOf('Base URL (接口地址)', gridStart);
    const modelButton = source.indexOf("{discovering ? '识别中' : '识别模型'}", sectionStart);

    assert.ok(sectionStart >= 0);
    assert.ok(modelButton > sectionStart && modelButton < gridStart, '识别模型按钮应位于配置标题与字段网格之间');
    assert.ok(baseLabel > gridStart);
    assert.match(source, /grid grid-cols-1 items-start gap-x-6 gap-y-6 md:grid-cols-2/);
    assert.equal((source.match(/flex h-5 items-center text-xs font-bold uppercase/g) || []).length, 4);
    assert.ok((source.match(/h-12 w-full/g) || []).length >= 5);
});
