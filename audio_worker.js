// culdcept-nx-installer (2026-11-20): one XMA file re-encoded to Opus on a worker of its own (lib/audio.js: the XMA
// frames decoded in WebAssembly, the browser's Opus encoder, the .xmo written). Answers { id, bytes, sound, bitrate }
// with { id, bytes, frames, why }: bytes null when the XMA is kept as it is (why says why).
import createXmaModule from './wasm/xma.mjs';
import { canEncodeOpus, reencodeAudio } from './lib/audio.js';

const xma = await createXmaModule({ print: () => {}, printErr: () => {} });
const opus = await canEncodeOpus();

// One sound file at a time, as movie_worker.js: the handler awaits the encoder, and a second job starting meanwhile
// would reopen the one XMA decoder (wasm/xma holds one file) under the first.
let chain = Promise.resolve();
self.onmessage = ({ data }) => { chain = chain.then(() => job(data)); };
async function job(data) {
  const { id, bytes, sound, bitrate } = data;
  let r;
  try {
    r = opus ? await reencodeAudio(bytes, xma, { id: sound, bitrate }) : { bytes: null, why: 'this browser has no Opus encoder' };
  } catch (e) {
    r = { bytes: null, why: e.message || String(e) };
  }
  self.postMessage({ id, bytes: r.bytes, frames: r.frames, why: r.why }, r.bytes ? [r.bytes.buffer] : []);
}
self.postMessage({ ready: true, opus });
