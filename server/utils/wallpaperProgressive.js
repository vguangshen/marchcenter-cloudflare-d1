import { createProgressiveJpegOptimizer } from './jpegCodec.js';
import mozjpegDecWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm';
import mozjpegEncWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';

export const optimizeJpegProgressive = createProgressiveJpegOptimizer({
  decodeWasm: mozjpegDecWasm,
  encodeWasm: mozjpegEncWasm
});
