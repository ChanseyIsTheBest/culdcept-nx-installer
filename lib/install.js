// renut_nx_ultimate_installer: the whole package, from the player's game to the zip, for any port of the ultimate base.
// The page's worker (worker.js) and the Node test (test/full_node.mjs) both run this, so what the test checks is what
// the page does. What is the game's own comes from game.json (the port's settings for this page) and the build's entry
// in release/manifest.json (tools/make_release.py):
//   1. the build: default.xex's SHA-256 names it; the NRO and the release files are checked by theirs;
//   2. the shaders (game.json "shaders"): the containers (lib/sources.js), Renut's translator (wasm/renut_hlsl), the
//      GLSL chain on worker threads (lib/chain.js: early alpha, DXC, SPIRV-Cross and the base's own passes in Pyodide)
//      -> deko3d_glsl.bin (version 2, lib/package.js: the GLSL and the shader table, so the NRO carries no game shader);
//      with compile, every variant of release/variants.txt compiled by uam (wasm/uam) -> deko3d_shaders.bin, the
//      console's DKSH cache, and pipeline_list.bin from the release (without the cache the list would make the console
//      compile everything at start);
//   3. the zip: the NRO, the release files, the shader files, the game's files under game_root/ (those game.json "lz4"
//      names packed as NAME.lz4b, LZ4 HC in 256 KB blocks, and those its "zxc" names as ZXC in 512 KB blocks, which the
//      SDK reads as NAME: lib/lz4b.js) and the DLC packages under dlc/, streamed to `sink` as it is written (its size is
//      known only at the end);
//   4. (blur-nx, 2026-11-18) the title update, when the build names one (its "update", lib/update.js): its default.xexp
//      to game_root/, its other files to update/.
import { compileVariants, makeGlsl, packageShaders, variantJobs } from './build.js';
import { checkGameFiles, describeProblems, optionalPaths } from './game_check.js';
import { pack, SUFFIX } from './lz4b.js';
import { nroShaders } from './nro.js';
import { gameContainers, sha256 } from './sources.js';
import { checkUpdate, updatePlacement } from './update.js';
import { parseVariants } from './variants.js';
import { ZipWriter } from './zip.js';
import { soundIds, XMO_SUFFIX, xmoBitrate } from './xmo.js';

// The game.json patterns: case-insensitive regular expressions on a file's path in the game folder.
const patterns = (list) => (list || []).map((p) => new RegExp(`^(?:${p})$`, 'i'));
const matches = (res, path) => res.some((re) => re.test(path));

// culdcept-nx-installer (2026-11-20): jobs for `list`'s files started ahead of the zip, at most `window` at a time
// (each holds its file's bytes until the zip takes its result): path -> promise of start(file).
function jobsAhead(list, window, start) {
  const jobs = new Map();
  let next = 0, inFlight = 0;
  const launch = () => {
    while (inFlight < window && next < list.length) {
      const f = list[next++];
      ++inFlight;
      jobs.set(f.path, start(f).finally(() => { --inFlight; launch(); }));
    }
  };
  launch();
  return jobs;
}

async function* chunks(file, size = 8 << 20) {
  for (let at = 0; at < file.size; at += size) yield await file.read(at, Math.min(size, file.size - at));
}

// The build of release/manifest.json this default.xex is, or throws. 2026-11-18: also throws when the copy is not
// whole (the build's "game_files", lib/game_check.js), as the page refuses it when it is chosen (app.js); game:
// game.json, for the files that may be absent (without it, only the disc's own extras may).
export async function findBuild(manifest, files, game = {}) {
  const xex = files.find((f) => f.path.toLowerCase() === 'default.xex');
  if (!xex) throw new Error('no default.xex in the folder: choose the folder the game was extracted to, or the disc image');
  const bytes = await xex.read(0, xex.size);
  const hash = await sha256(bytes);
  const build = manifest.builds.find((b) => b.xex_sha256 === hash);
  if (!build) throw new Error(`this default.xex is not one this release supports (SHA-256 ${hash})`);
  const problems = describeProblems(checkGameFiles(files, build.game_files, optionalPaths(game)));
  if (problems) throw new Error(problems);
  return { build, xex: bytes };
}

// game: game.json; manifest: release/manifest.json; files, dlc, update: [{ path, size, read(offset, length) }];
// fetchRelease(name, sha256) -> bytes (checked); sink: { write(bytes), close() }; compile: make the DKSH cache;
// tools: { translator, lzx, xexp (Emscripten modules; xexp when the build has a title update), cores, glslThreads, startGlsl(n), startUam(n), startLz4(n) }, each
// start returning { run, version?, stop() } over n workers (lib/pool.js): glsl run(name, hlsl) -> UTF-8 GLSL,
// uam run(stage, text) -> { dksh } | { error }, pack run(bytes, codec) -> bytes (codec 'lz4' or 'zxc': lib/lz4b.js).
// events: { log(text), progress(fraction), start(estimate of the zip's size) }. Returns what it did.
// movies (culdcept-nx-installer, 2026-11-20): re-encode game.json's "movies" to H.265 (tools.startMovies, the page's
// movie_worker.js; the Node test has none and keeps the WMVs). audio (2026-11-20): game.json's "audio" as Opus (.xmo
// files: tools.startAudio, the page's audio_worker.js; the Node test has none and keeps the XMA).
export async function buildPackage({ game, manifest, files, dlc = [], update = [], fetchRelease, tools, sink, compile = true,
                                     movies = true, audio = true, events }) {
  const { log = () => {}, progress = () => {}, start = () => {} } = events || {};
  const began = performance.now();
  const seconds = () => Math.round((performance.now() - began) / 1000);
  const root = `switch/${game.package}`;
  const report = {};
  const running = [];
  const stopAll = () => { for (const r of running.splice(0)) r.stop(); };
  try {
    const { build, xex } = await findBuild(manifest, files, game);
    const updateProblem = await checkUpdate(build, update, game.update?.title);
    if (updateProblem) throw new Error(updateProblem);
    const updateFiles = updatePlacement(build, update);
    const shaders = game.shaders && build.shaders;
    // culdcept-nx-installer (2026-11-21): game.json "compile": false, no DKSH cache (app.js hides the option)
    if (!shaders || game.compile === false) compile = false;
    // the shares of the bar: the shaders take the time, the zip the bytes
    const steps = shaders ? (compile ? { glsl: [0, 0.45], uam: [0.45, 0.65], zip: [0.65, 1] } : { glsl: [0, 0.5], zip: [0.5, 1] })
      : { zip: [0, 1] };
    const step = (s) => (f) => progress(steps[s][0] + (steps[s][1] - steps[s][0]) * f);

    log('Downloading the program and its files...');
    const nro = await fetchRelease(build.nro, build.nro_sha256);
    const extras = [];
    for (const f of build.files || []) {
      if (f.with_cache && !compile) continue;  // pipeline_list.bin: only with deko3d_shaders.bin (see above)
      extras.push({ ...f, bytes: await fetchRelease(f.source, f.sha256) });
    }
    const made = [];  // [path, bytes] of the shader files
    if (shaders) {
      const shaderCommon = await fetchRelease('shader_common.h', manifest.shader_common_sha256);
      // a port of a title update's code: its shaders in the patched image (lib/xexp.js)
      const xexpFile = updateFiles.find((u) => u.to === 'game_root/default.xexp')?.file;
      const patch = xexpFile ? { xexp: await xexpFile.read(0, xexpFile.size), mod: tools.xexp } : null;
      if (patch && !patch.mod) throw new Error('this release needs wasm/xexp (for the title update patch)');
      const containers = await gameContainers(files, xex, shaders, tools.lzx, log, patch);
      log(`Making the GLSL of ${containers.length} shaders on ${tools.glslThreads} threads...`);
      const glsl = await tools.startGlsl(tools.glslThreads);
      running.push(glsl);
      const errors = [];
      const { shaders: list, failed } = await makeGlsl(containers, tools.translator, glsl.run, shaderCommon, log,
                                                       step('glsl'), (e) => errors.push(e));
      glsl.stop();
      if (failed) throw new Error(`${failed} shaders could not be made: ${errors.slice(0, 3).join('; ')}`);
      const glslPackage = packageShaders(list);
      made.push(['deko3d_glsl.bin', glslPackage]);
      report.shaders = list.length;
      report.glslSha256 = await sha256(glslPackage);
      report.glsl = list;  // [{ name, glsl (UTF-8), numbers }]: for the tests' comparisons
      if (compile) {
        // every variant the game uses, and the NRO's own shaders' (the ones the game makes at runtime)
        // (a release without a pipeline list has no variants.txt: each shader is compiled as it is)
        const variants = build.variants_sha256
          ? parseVariants(new TextDecoder().decode(await fetchRelease('variants.txt', build.variants_sha256))) : [];
        const glslOf = new Map(list.map((s) => [s.name, s.glsl]));
        for (const [stem, text] of nroShaders(nro)) if (!glslOf.has(stem)) glslOf.set(stem, text);
        const { jobs } = variantJobs(variants, glslOf);
        log(`Compiling ${jobs.length} shader variants for the Switch on ${tools.cores} threads...`);
        const uam = await tools.startUam(tools.cores);
        running.push(uam);
        const compiled = await compileVariants(jobs, uam.run, tools.cores * 2, step('uam'));
        uam.stop();
        if (compiled.failures.length) {
          throw new Error(`${compiled.failures.length} shader variants did not compile: ${compiled.failures[0].error.slice(0, 200)}`);
        }
        made.push(['deko3d_shaders.bin', compiled.cache]);
        report.variants = jobs.length;
        report.cacheSha256 = await sha256(compiled.cache);
      }
      const reference = build.deko3d_glsl_sha256 === report.glslSha256 &&
                        (!compile || build.deko3d_shaders_sha256 === report.cacheSha256);
      log(`Shaders done in ${seconds()} s: ${report.shaders} shaders` + (compile ? `, ${report.variants} variants` : ', left for the Switch to compile') +
          (build.deko3d_glsl_sha256 ? (reference ? ', the same as the release\'s reference build' : ' (not the reference build\'s)') : ''));
    }

    // the zip
    // culdcept-nx-installer (2026-11-20): "zxc" (ZXC 7, 512 KB blocks) beside "lz4" (LZ4 HC 9, 256 KB blocks), the
    // codecs of rr6-nx-installer; a file both lists name is ZXC's.
    const lz4 = patterns(game.lz4), zxc = patterns(game.zxc), skip = patterns(game.skip);
    const codecOf = (path) => (matches(zxc, path) ? 'zxc' : matches(lz4, path) ? 'lz4' : null);
    const game_ = files.filter((f) => !matches(skip, f.path));
    const toPack = game_.filter((f) => codecOf(f.path));
    let packPool = null;
    if (toPack.length) {
      packPool = await tools.startPack(tools.cores);
      running.push(packPool);
      const version = (v) => `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}`;
      const n = (codec) => toPack.filter((f) => codecOf(f.path) === codec).length;
      log(`LZ4 ${version(packPool.version)} for ${n('lz4')} file${n('lz4') === 1 ? '' : 's'} and ZXC ` +
          `${version(packPool.zxcVersion)} for ${n('zxc')} on ${tools.cores} threads.`);
    }
    // culdcept-nx-installer (2026-11-20, the user: "an option in thr web browser on by default to rencode videos ... we
    // can leave wmv as fallback"): game.json's "movies" ({ match, fraction, gop }) re-encoded to H.265 on movie workers
    // (movie_worker.js: lib/movies.js), started now and taken in the zip's order, two per worker at a time; a movie the
    // browser cannot re-encode goes into the zip as it is.
    let movieJobs = new Map();
    let moviePool = null, moviesIn = 0, moviesOut = 0;
    if (movies && game.movies && tools.startMovies) {
      const re = patterns([game.movies.match]);
      const list = game_.filter((f) => matches(re, f.path));
      if (list.length) {
        moviePool = await tools.startMovies(Math.max(1, Math.min(4, tools.cores >> 1)));
        running.push(moviePool);
        if (!moviePool.hevc) {
          log('This browser cannot encode H.265 (WebCodecs with the computer\'s video hardware): the movies stay WMV.');
        } else {
          log(`Re-encoding ${list.length} movies to H.265 (${Math.round((game.movies.fraction || 0.35) * 100)} % of ` +
              `their bitrate) on ${moviePool.size} workers, with this computer's video encoder.`);
          movieJobs = jobsAhead(list, moviePool.size * 2, (f) => f.read(0, f.size).then((bytes) =>
            moviePool.run(bytes, { fraction: game.movies.fraction, gop: game.movies.gop })));
        }
      }
    }
    // culdcept-nx-installer (2026-11-20, the user: "Yeah I think I want to rencode the audio the to opus", "Lets go with
    // 128k"): game.json's "audio" ({ match, bitrates }) re-encoded to Opus on audio workers (audio_worker.js:
    // lib/audio.js), as NAME.xmo, which the port plays as the XMA file NAME (its rex/filesystem/xmo.h). A file the port
    // cannot play that way (not 48 kHz, ...) or that is not smaller goes into the zip as it is. The jobs run ahead of the
    // zip, a few files per worker at a time (the game has two thousand sound files).
    let audioJobs = new Map();
    let audioPool = null, audioIn = 0, audioOut = 0, audioKept = 0;
    const audioWhy = new Map();  // why files stayed XMA: how many, and the first one
    if (audio && game.audio && tools.startAudio) {
      const re = patterns([game.audio.match]);
      const list = game_.filter((f) => matches(re, f.path));
      if (list.length) {
        audioPool = await tools.startAudio(Math.max(1, Math.min(8, tools.cores)));
        running.push(audioPool);
        if (!audioPool.opus) {
          log('This browser cannot encode Opus (WebCodecs): the sounds stay XMA.');
        } else {
          const ids = soundIds(list.map((f) => f.path));
          const rules = game.audio.bitrates || [{ match: '.*', stereo: 128000, mono: 64000 }];
          log(`Re-encoding ${list.length} sound files to Opus on ${audioPool.size} workers (48 kHz ones; the others stay XMA).`);
          audioJobs = jobsAhead(list, audioPool.size * 3, (f) => f.read(0, f.size).then((bytes) => {
            const channels = bytes.length > 50 ? bytes[20 + 12 + 17] : 2;  // XMASTREAMFORMAT's channels (lib/xmo.js)
            return audioPool.run(bytes, { sound: ids.get(f.path), bitrate: xmoBitrate(rules, f.path, channels) || 128000 });
          }));
        }
      }
    }
    const totalIn = nro.length + extras.reduce((n, f) => n + f.bytes.length, 0) + made.reduce((n, [, b]) => n + b.length, 0) +
                    game_.reduce((n, f) => n + f.size, 0) + dlc.reduce((n, f) => n + f.size, 0) +
                    updateFiles.reduce((n, u) => n + u.file.size, 0);
    let doneIn = 0;
    const zipStep = step('zip');
    const counted = (n) => { doneIn += n; zipStep(doneIn / totalIn); };
    start(totalIn - toPack.reduce((n, f) => n + f.size, 0) * 0.4);  // a guess: packing saves 20-65 %
    const zip = new ZipWriter(sink);
    await zip.addBytes(`${root}/${game.nro}`, nro); counted(nro.length);
    for (const f of extras) { await zip.addBytes(`${root}/${f.path}`, f.bytes); counted(f.bytes.length); }
    for (const [name, bytes] of made) { await zip.addBytes(`${root}/${name}`, bytes); counted(bytes.length); }
    let packedIn = 0, packedOut = 0;
    for (const f of game_) {
      const codec = packPool ? codecOf(f.path) : null;
      if (codec) {
        const t0 = performance.now();
        // a line for each file of 8 MB or more (the many small effect and sound files would bury the log)
        const named = f.size >= 8 << 20;
        if (named) log(`Packing ${f.path} (${(f.size / 1048576).toFixed(0)} MB, ${codec.toUpperCase()})...`);
        const size = await zip.addStream(`${root}/game_root/${f.path}${SUFFIX}`,
                                         pack(f, packPool.run, { codec, inFlight: tools.cores * 4, onRaw: counted }));
        packedIn += f.size;
        packedOut += size;
        const s = (performance.now() - t0) / 1000;
        if (named) log(`  ${f.path}${SUFFIX}: ${(size / 1048576).toFixed(0)} MB (${(size / f.size * 100).toFixed(1)} %), ${s.toFixed(0)} s`);
      } else if (movieJobs.has(f.path)) {
        const r = await movieJobs.get(f.path);
        movieJobs.delete(f.path);
        if (r.bytes) {
          await zip.addBytes(`${root}/game_root/${f.path}`, r.bytes);
          counted(f.size);
          moviesIn += f.size;
          moviesOut += r.bytes.length;
          log(`  ${f.path}: H.265, ${(f.size / 1048576).toFixed(1)} MB -> ${(r.bytes.length / 1048576).toFixed(1)} MB ` +
              `(${r.kbps} kbit/s, ${r.frames} frames)`);
        } else {
          log(`  ${f.path}: kept as WMV (${r.why})`);
          await zip.addFile(`${root}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
        }
      } else if (audioJobs.has(f.path)) {
        const r = await audioJobs.get(f.path);
        audioJobs.delete(f.path);
        if (r.bytes) {
          await zip.addBytes(`${root}/game_root/${f.path}${XMO_SUFFIX}`, r.bytes);
          counted(f.size);
          audioIn += f.size;
          audioOut += r.bytes.length;
        } else {
          ++audioKept;
          const why = (r.why || '?').replace(/\d+/g, 'N');
          const seen = audioWhy.get(why);
          audioWhy.set(why, seen ? [seen[0] + 1, seen[1]] : [1, `${f.path}: ${r.why}`]);
          await zip.addFile(`${root}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
        }
      } else {
        await zip.addFile(`${root}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
      }
    }
    if (audioIn) {
      log(`Audio: ${(audioIn / 1048576).toFixed(0)} MB of XMA as ${(audioOut / 1048576).toFixed(0)} MB of Opus; ` +
          `${audioKept} files kept as XMA:`);
      for (const [why, [n, first]] of audioWhy) log(`  ${n} x ${why} (${first})`);
    }
    if (moviesIn) {
      log(`Movies: ${(moviesIn / 1048576).toFixed(0)} MB of WMV as ${(moviesOut / 1048576).toFixed(0)} MB of H.265.`);
    }
    for (const u of updateFiles) await zip.addFile(`${root}/${u.to}`, u.file.size, chunks(u.file), (c) => counted(c.length));
    if (updateFiles.length) log(`${game.update?.title || 'The title update'}: ${updateFiles.length} files.`);
    for (const f of dlc) await zip.addFile(`${root}/dlc/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
    report.size = await zip.finish();
    stopAll();
    if (packedIn) {
      log(`Packed ${(packedIn / 1048576).toFixed(0)} MB to ${(packedOut / 1048576).toFixed(0)} MB: ` +
          `${((packedIn - packedOut) / 1048576).toFixed(0)} MB smaller on the SD card.`);
    }
    Object.assign(report, { build: build.edition, packedIn, packedOut, moviesIn, moviesOut, audioIn, audioOut, audioKept,
                            seconds: seconds() });
    return report;
  } catch (error) {
    stopAll();
    throw error;
  }
}
