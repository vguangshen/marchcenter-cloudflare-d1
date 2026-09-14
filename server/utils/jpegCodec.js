import { init as initJpegDecode, default as decodeJpeg } from '@jsquash/jpeg/decode.js';
import { init as initJpegEncode, default as encodeJpeg } from '@jsquash/jpeg/encode.js';
import { inspectJpeg } from '../../scripts/jpeg-utils.mjs';

const PROGRESSIVE_JPEG_QUALITY = 78;

/**
 * MozJPEG WASM is supplied by the caller so the same codec module can be
 * tested in Node and bundled with static `.wasm` imports by Wrangler.
 */
export function createProgressiveJpegOptimizer({ decodeWasm, encodeWasm }) {
  let codecsReady = null;
  const ensureCodecs = () => {
    if (!codecsReady) {
      codecsReady = Promise.all([
        initJpegDecode(decodeWasm),
        initJpegEncode(encodeWasm)
      ]);
    }
    return codecsReady;
  };

  return async function optimizeJpegProgressive(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const info = inspectJpeg(input);
    if (!info) throw new Error('输入不是 JPEG');
    if (info.progressive) return input;

    await ensureCodecs();
    const image = await decodeJpeg(input);
    const output = await encodeJpeg(image, {
      quality: PROGRESSIVE_JPEG_QUALITY,
      progressive: true,
      baseline: false,
      optimize_coding: true
    });
    const optimized = new Uint8Array(output);
    if (!inspectJpeg(optimized)?.progressive) {
      throw new Error('MozJPEG 重编码结果不是 progressive JPEG');
    }
    return optimized;
  };
}
