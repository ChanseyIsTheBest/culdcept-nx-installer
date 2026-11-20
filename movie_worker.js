// culdcept-nx-installer (2026-11-20): one movie re-encoded to H.265 on a worker of its own (lib/movies.js: the WMV3
// decoder in WebAssembly, the browser's H.265 encoder, the ASF remux). Answers { id, bytes, fraction, gop } with
// { id, bytes, frames, kbps, why }: bytes null when the WMV is kept as it is (why says why).
import createWmv3Module from './wasm/wmv3.mjs';
import { canEncodeHevc, reencodeMovie } from './lib/movies.js';

const wmv3 = await createWmv3Module({ print: () => {}, printErr: () => {} });
const hevc = await canEncodeHevc();

self.onmessage = async ({ data }) => {
  const { id, bytes, fraction, gop } = data;
  let r;
  try {
    r = hevc ? await reencodeMovie(bytes, wmv3, { fraction, gop }) : { bytes: null, why: 'this browser has no H.265 encoder' };
  } catch (e) {
    r = { bytes: null, why: e.message || String(e) };
  }
  self.postMessage({ id, bytes: r.bytes, frames: r.frames, kbps: r.kbps, why: r.why }, r.bytes ? [r.bytes.buffer] : []);
};
self.postMessage({ ready: true, version: wmv3._wmv3_version(), hevc });
