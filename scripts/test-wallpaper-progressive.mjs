import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { createProgressiveJpegOptimizer } from '../server/utils/jpegCodec.js';
import { inspectJpeg } from './jpeg-utils.mjs';

const require = createRequire(import.meta.url);
const decodeWasm = await WebAssembly.compile(await readFile(
  require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm')
));
const encodeWasm = await WebAssembly.compile(await readFile(
  require.resolve('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm')
));
const optimize = createProgressiveJpegOptimizer({ decodeWasm, encodeWasm });

const baseline = await sharp({
  create: {
    width: 96,
    height: 64,
    channels: 3,
    background: { r: 32, g: 96, b: 160 }
  }
}).jpeg({ quality: 78, progressive: false }).toBuffer();
assert.equal(inspectJpeg(baseline).progressive, false, '测试输入必须是 baseline JPEG');

const optimized = await optimize(baseline);
assert.notEqual(optimized, baseline, 'baseline 输入必须重编码');
assert.equal(inspectJpeg(optimized).progressive, true, 'MozJPEG 输出必须是 progressive JPEG');

const progressive = await sharp({
  create: {
    width: 96,
    height: 64,
    channels: 3,
    background: { r: 200, g: 120, b: 40 }
  }
}).jpeg({ quality: 78, progressive: true }).toBuffer();
assert.equal(inspectJpeg(progressive).progressive, true, '测试输入必须是 progressive JPEG');
assert.equal(await optimize(progressive), progressive, '已是 progressive 时不得重复重编码');

console.log('Progressive JPEG optimizer tests passed');
