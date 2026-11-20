// culdcept-nx-installer (2026-11-20, the user: "Yeah I think I want to rencode the audio the to opus", "Lets go with
// 128k"): one of the game's XMA files as NAME.xmo (lib/xmo.js), with the browser's Opus encoder (WebCodecs'
// AudioEncoder: libopus in Chrome, Edge and Firefox). The same file as test/audio_node.mjs makes with ffmpeg's libopus.
// Returns { bytes: null, why } when the file stays XMA: not one the port can play from Opus (lib/xmo.js xmoRefusal),
// or no Opus encoder in this browser.
import { openXma, writeXmo, xmoRefusal } from './xmo.js';

const OPUS_LOOKAHEAD = 312;  // libopus's at 48 kHz (2.5 ms + 4 ms): the pre-skip when the encoder gives no OpusHead

export function opusConfig(channels, bitrate) {
  return {
    codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate, bitrateMode: 'variable',
    opus: { frameDuration: 20000, complexity: 10, application: 'audio', format: 'opus' },
  };
}

export async function canEncodeOpus() {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    return !!(await AudioEncoder.isConfigSupported(opusConfig(2, 128000))).supported;
  } catch {
    return false;
  }
}

// bytes: the .xma file; xma: an instance of wasm/xma.mjs; id: the sound id (lib/xmo.js soundIds); bitrate in bit/s.
export async function reencodeAudio(bytes, xma, { id, bitrate }) {
  const x = openXma(xma, bytes);
  if (!x.info) return { bytes: null, why: x.why };
  const refusal = xmoRefusal(x.info);
  if (refusal) { x.close(); return { bytes: null, why: refusal }; }
  const { info } = x;
  const config = opusConfig(info.channels, bitrate);
  if (!(await AudioEncoder.isConfigSupported(config)).supported) { x.close(); return { bytes: null, why: 'no Opus encoder' }; }

  const packets = [];
  let preSkip = null, failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      packets.push(d);
      const desc = meta?.decoderConfig?.description;
      if (preSkip === null && desc) {
        const h = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        if (h.length >= 12 && new TextDecoder().decode(h.subarray(0, 8)) === 'OpusHead') preSkip = h[10] | (h[11] << 8);
      }
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  try {
    let time = 0;
    const feed = (pcm) => {
      const frames = pcm.length / info.channels;
      const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: frames,
                                   numberOfChannels: info.channels, timestamp: Math.round(time * 1e6 / 48000), data: pcm });
      encoder.encode(data);
      data.close();
      time += frames;
    };
    for (let f = 0; f < info.frames && !failure;) {
      const part = x.decode(Math.min(1024, info.frames - f));
      feed(part);
      f += part.length / (512 * info.channels);
      while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 1));
    }
    feed(new Float32Array(2 * 512 * info.channels));  // two frames of silence: the encoder's tail covers the last frame
    await encoder.flush();
  } catch (e) {
    failure = failure || e;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    x.close();
  }
  if (failure) return { bytes: null, why: `the Opus encoder failed: ${failure.message || failure}` };
  try {
    const xmo = writeXmo(bytes, info, id, { packets, preSkip: preSkip ?? OPUS_LOOKAHEAD });
    // a few short effects are smaller as XMA than at the Opus bitrate: they stay XMA
    if (xmo.length >= bytes.length) return { bytes: null, why: `not smaller as Opus (${xmo.length} bytes)` };
    return { bytes: xmo, frames: info.frames, why: null };
  } catch (e) {
    return { bytes: null, why: e.message || String(e) };
  }
}
