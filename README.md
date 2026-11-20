# culdcept-nx-installer

The web installer of culdcept-nx (Culdcept Saga, Xbox 360 title 424107DD, on the Switch), a copy of
renut_nx_ultimate_installer (2ce44cf) with its own `game.json`, colours, `icon.png` (a plain placeholder) and `release/`
(made by `tools/make_release.py` from culdcept-nx's build). What differs from the template:

- **`"shaders": false`: the NRO carries the game's seven shaders itself** (the everyday build, not
  `-DBANJO_RENUT_RELEASE_SHADERS=ON`). Culdcept Saga compiles two of them at run time from `data/shader.fx` with D3DX
  (no game file holds them), two more are made at run time from parts, and the three in `default.xex` are version 0x10
  containers (flags `0x102A10xx`, XDK 2.0.3424), which this page's scanner (`\x10\x2a\x11`) and its WebAssembly
  translator (built from the base, without culdcept-nx's `container_10.h`) do not read. Seven shaders, 16 KB of GLSL:
  the console compiles them in about a second at the first start. The page makes no shader file and no DKSH cache.
- **No DLC step** (`"dlc": false`) and no title update: the game needs neither.
- **Packing** (2026-11-20, the user: "Just L4Z compress all files besides data04 rsp and effects which can be zxc
  compressed dont bother compressing movies or audio no navings therr"), by `game.json`'s `lz4` and `zxc` (the `zxc`
  list is this copy's addition to the template, with rr6-nx-installer's ZXC; see "ZXC packing" below):
  - **ZXC 7, 512 KB blocks**: `data/DATA04.RSP` and the effect, model and layout files (`.rse .rst .rsa .rsm .rsl` in
    `data/EFFECT`, `eeprev` and `layout`): 3,576 files, 1,768 MB -> 991 MB.
  - **LZ4 HC 9, 256 KB blocks**: every other file but `default.xex` (the NRO loads it itself), the movies and the
    audio: 140 files, 1,505 MB -> 884 MB.
  - **As they are**: `default.xex`, `data/MOVIE` (WMV) and `data/SOUND` (XMA): both codecs leave them at 99 %.
  - In all 4,707.6 MB -> 3,309.1 MB. Both codecs measured on every file (2026-11-20): LZ4 alone would give 3,333 MB,
    ZXC alone 3,354 MB; ZXC wins on DATA04 (705 against 737 MB) and the effects, LZ4 on the other archives (DATA06 370
    against 410 MB). The packed files need culdcept-nx with rr6-nx's reader (2026-11-20 on: ZXC is version 2 of the
    `.lz4b` container); `test/pack_node.mjs` makes the same folder on a PC for test runs.
- **Checked** (2026-11-19): `release/` made by `tools/make_release.py` (the NRO of culdcept-nx f67e880d, 5,860 game files
  in the manifest); `node test/game_check_node.mjs <game folder>`: every case passes but "without d02.dat-d05.dat it is
  refused", which is Beautiful Katamari's own case (it names Katamari's archives); the page served by `serve.py` shows
  Culdcept's texts. A whole package (`test/full_node.mjs`) was not made (a 4.9 GB zip of game data).
- Nothing here is published: the user publishes it (GitHub Pages) if they choose. The NRO carries translated shaders
  of the game (see above): that is the user's decision before publishing.

Everything else below is the template's text.

# renut_nx_ultimate_installer

The web installer for ports made from the ultimate base ([renut_nx_ultimate_base](https://github.com/ChanseyIsTheBest/renut_nx_ultimate_base)).
A port forks it, edits `game.json` (and the page's colours and `icon.png`), fills `release/` with its NRO, and publishes it
on GitHub Pages. The page makes the whole Switch package from the player's own copy of the game, in their browser:

- **The shaders**, from the game's own files, so the NRO carries none of them: the containers in `default.xex` and in
  the game's files, Renut's translator, DXC, SPIRV-Cross and the base's own Python passes (run unchanged in Pyodide),
  into `deko3d_glsl.bin`; and optionally every shader variant compiled by uam, the console's compiler, into
  `deko3d_shaders.bin`, so the game starts with no compile stutters.
- **LZ4 packing** of the large archives `game.json` names: LZ4 HC level 9 in 256 KB blocks, as `NAME.lz4b`, which the
  base's SDK reads as `NAME` (port 61). Beautiful Katamari's archives go from 2.1 GB to 0.9 GB.
- **ZXC packing** (culdcept-nx-installer, 2026-11-20, from rr6-nx-installer) of the files `game.json`'s `zxc` names:
  ZXC 0.15.0 level 7 in 512 KB blocks, the same `NAME.lz4b` container (version 2), which needs a port with rr6-nx's
  reader (`sdk/src/filesystem/lz4_blocks.cpp` with `sdk/thirdparty/zxc`: culdcept-nx has it). ZXC packs smaller than
  LZ4 and decodes slower (~200 against ~590 MB/s on the console, rr6-nx's runs): for files read while they play.
- **The zip**, streamed to a download as it is written (it can be bigger than the browser's memory).

The example in this repository is Beautiful Katamari, the base's own game: the base's NRO built with
`-DBANJO_RENUT_RELEASE_SHADERS=ON`, its 195 shaders (111 in `default.xex`, 84 in the models of `d02.dat`-`d05.dat`).

## Making a port's installer

1. **`game.json`**: the game's title, the port's folder on the SD card (`package`: `switch/<package>/`), the NRO's name,
   whether the page makes the shaders (`shaders`), which files are packed with LZ4 (`lz4`, case-insensitive regular
   expressions on paths in the game folder) and which with ZXC (`zxc`, the same; a file both name is ZXC's), which
   are left out (`skip`), which must be there (`needs`), which may be
   absent from a player's copy (`optional`; see step 4), whether it takes DLC packages (`dlc`, copied whole to
   `switch/<package>/dlc/`, which the base installs at the first start), whether the port is recompiled from a title
   update's code (`update`, below), and the page's texts.

   **A port of a title update's code** (blur-nx-installer, 2026-11-18) sets `"update": { "title": "title update 2" }`
   and a `texts.update` note. The page then asks for that update too: the Xbox 360 package the player has (a LIVE,
   PIRS or CON file, read in the browser by `lib/stfs.js`), the folder that holds it, or the folder it was extracted to.
   It is checked against the build's `update` (`make_release.py --update`: its `default.xexp`'s SHA-256 and its other
   files with their sizes, `lib/update.js`). Its `default.xexp` goes next to `default.xex` in `game_root/` (the runtime
   applies the patch) and its other files to `update/` (mounted as the console's `UPDATE:`). The shaders of
   `default.xex` are read from the image with the patch applied, as the runtime loads it (`lib/xexp.js`: Xenia's
   XexModule::ApplyPatch, the LZX delta step in `wasm/xexp`, built by `wasm/src/xexp/build.sh` from the SDK's own
   libmspack): a patch can change every one of them (all 519 of Blur's).
2. **The NRO**: build the port with `-DBANJO_RENUT_RELEASE_SHADERS=ON` (no game shader in it). A shader the game makes
   at runtime (one no game file holds) must stay in the NRO: `tools/make_release.py` stops when the port's shader dump
   has one that is neither in `default.xex` nor in a record.
3. **Shaders in the game's files** (if any): write the records, a list of where each container is (file, offset, stored
   size, coding, and the container's offset, length and SHA-256 in the decoded bytes), with a tool of the port's own
   (katamari-nx's `tools/katamari_shader_files.py` is the example). The codings are in `lib/sources.js` (`raw`, `zlib`,
   `cpdb`); a new one goes there.
4. **The release**:

   ```bash
   python tools/make_release.py --port <port root> --nro <NRO> --game <game folder> --records <records.json> --pipeline-list <pipeline_list.bin> --version 1.0.0
   ```

   `--pipeline-list` (a console's or Ryujinx's `pipeline_list.bin`) gives `variants.txt`, the variants the page compiles,
   and ships the list itself (the console prebuilds those pipelines). `--file <src>[:<name>]` adds a release file (a
   settings file, for example; a Windows path's drive is not taken for the name). `--update <folder>`, the title update
   extracted, records it for a port of its code (step 1); then pass the update to the tests too
   (`full_node.mjs --update=<package or folder>`, `check_zip.py <zip> <game> <update folder>`).

   The build also records the game's files with their sizes (`game_files`, from `--game`, less what `skip` leaves out).
   The page refuses a copy missing any of them, or with one of another size, and names what is wrong
   (`lib/game_check.js`): "data/ (all 1384 files)", "cse/ (12 of 40 files: ...)". So a copy with `default.xex` (and
   `default.xexp`) and little else is caught when it is chosen, not at the console. The disc's own extras
   (`$SystemUpdate`, `$TitleUpdate`, `nxeart`, `AvatarAssetPack`) and what `optional` names are never required. For a
   manifest made before this, add the list with `python tools/game_files.py <game folder>`; check it with
   `node test/game_check_node.mjs <game folder>`.

   Then make the reference shader files and check the whole package:

   ```bash
   node test/full_node.mjs <game folder> <out.zip> --reference --native-glsl=<port>/out/deko3d_shaders/glsl_opt
   ```

   ```bash
   python test/check_zip.py <out.zip> <game folder>
   ```

5. **The tools**: when the port's shader tools differ from the base's, copy them in with
   `python tools/sync_from_base.py --base <port root>`, and rebuild `wasm/renut_hlsl` and `wasm/uam` from the port
   (`BANJO_NX=<port root> bash wasm/src/translator/build_wasm_translator.sh`, the same for
   `wasm/src/uam/build_wasm_uam.sh`; Emscripten 6.0.11, the emsdk named in the scripts).

The NRO reads a `deko3d_glsl.bin` only with its own tag (`kInstalledTag` in the base's `banjo_renut_deko3d.cpp`,
`INSTALLED_TAG` in `lib/package.js`), and a DKSH cache only with its compiler's tag (`CACHE_TAG` in `lib/variants.js`):
change both sides together.

## How the page works

| Path | What it does |
|---|---|
| `index.html`, `app.js` | the page: the game (a disc image, `lib/xiso.js`, or a folder), the DLC, the options |
| `lib/game_check.js` | whether the chosen copy is whole: the build's `game_files`, what is missing named |
| `lib/stfs.js`, `lib/update.js`, `lib/xexp.js`, `wasm/xexp` | a title update: its package read, checked and placed; its patch applied to `default.xex`'s image |
| `worker.js` | runs `lib/install.js` off the page's thread and streams the zip to `sw.js` |
| `lib/install.js` | the whole build: the release files, the shaders, the zip (the page and `test/full_node.mjs` both run it) |
| `lib/sources.js` | the shader containers: `default.xex` (`lib/xex.js`, LZX in `wasm/lzx`) and the records' codings |
| `lib/build.js`, `lib/chain.js`, `lib/glsl_job.js`, `glsl_worker.js` | the translator and the GLSL chain on worker threads |
| `lib/package.js` | `deko3d_glsl.bin` (version 2: the GLSL and the shader table's numbers) |
| `lib/variants.js`, `lib/uam.js`, `uam_worker.js` | the variants and the DKSH cache (`deko3d_shaders.bin`) |
| `lib/lz4b.js`, `pack_worker.js` | the block files (`wasm/lz4`: LZ4 1.10.0 HC; `wasm/zxc`: ZXC 0.15.0), one worker for both |
| `lib/zip.js`, `sw.js` | the zip writer and the download stream |
| `py/` | the base's Python shader tools, unchanged (`tools/sync_from_base.py`) |
| `release/` | the NRO, `shader_common.h`, `variants.txt`, `pipeline_list.bin`, `manifest.json` |

## Testing locally

```bash
python serve.py 8193 .
```

Then open http://127.0.0.1:8193/ in a Chromium browser. The browser test makes a zip from a served game folder with no
file dialogs:

```bash
python serve.py 8193 . --test-files <game folder> --test-out test/out_zip/package.zip
```

and open http://127.0.0.1:8193/test/browser.html (`?compile=0` leaves the DKSH cache out), then
`python test/check_zip.py test/out_zip/package.zip <game folder>`.

Outputs of the tests (zips, shader files) are game data: never commit or share them.

## License

GPL-3.0 (see [LICENSE](LICENSE)). Third-party components are listed in [NOTICES.md](NOTICES.md).
