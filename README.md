# OpenArena Web

OpenArena Web runs the maintained ioquake3 C engine in a desktop browser through WebAssembly. Vite provides the HTML/CSS/JavaScript shell; the actual game, bot logic, renderer, and audio mixer remain native id Tech 3 code compiled by Emscripten.

The repository intentionally does **not** contain retail Quake III data. Its asset preparation step downloads the freely redistributable OpenArena 0.8.8 content and verifies the official SHA-1 before copying its PK3 archives into the web build.

## Quick start on Windows

Prerequisites:

- Node.js 20 or newer
- Git
- CMake 3.24 or newer on `PATH`
- Visual Studio Build Tools with C++ support or Ninja

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-emsdk.ps1
$env:EMSDK="$PWD\vendor\emsdk"
& "$env:EMSDK\emsdk_env.ps1"
npm run prepare:assets
npm run build:engine
npm run dev
```

Open the URL printed by Vite, then click **Play**. The first asset preparation downloads approximately 426 MiB. Browser loading is faster after HTTP and IndexedDB caches are populated.

If OpenArena has already been downloaded, avoid downloading it again:

```powershell
npm run prepare:assets -- -Archive "C:\path\to\openarena-0.8.8.zip"
```

Use `npm run build:engine -- -Clean` for a clean WebAssembly rebuild. `npm run build` creates the static site in `dist`; `npm run preview` serves that production build locally.

## Linux/macOS setup

Install Node, CMake, Ninja or Make, `curl`, `unzip`, and `sha1sum`. Install and activate Emscripten SDK 4.0.19, then run:

```bash
npm install
./scripts/prepare-assets.sh
emcmake cmake -S vendor/ioq3 -B .cache/ioq3-wasm \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_CLIENT=ON -DBUILD_SERVER=OFF \
  -DBUILD_GAME_LIBRARIES=OFF -DBUILD_GAME_QVMS=OFF -DUSE_OPENAL=OFF \
  -DUSE_VOIP=OFF -DUSE_MUMBLE=OFF -DUSE_CODEC_OPUS=OFF
cmake --build .cache/ioq3-wasm --parallel
cp .cache/ioq3-wasm/Release/ioquake3.{js,wasm} public/engine/
npm run dev
```

The precise output subdirectory can vary by CMake generator. Copy the generated `ioquake3.js` and `ioquake3.wasm` into `public/engine` if they are emitted elsewhere.

## Controls and behavior

- WASD: move
- Mouse: aim; left button fires
- Space: jump
- 1–9 or mouse wheel: weapons
- Tab: scoreboard
- Escape: release the pointer and show the resume overlay
- Fullscreen and engine-log controls appear in the top-right during play

Click **Play** to load the native OpenArena main menu. Maps, game modes, bots, difficulty, and match limits are selected inside the real game UI rather than duplicated by the web shell.

The site requires HTTP(S); it cannot run directly from `file://`. The supported targets are current desktop Chrome, Edge, and Firefox with WebAssembly, WebGL2, Web Audio, and Pointer Lock enabled. The canvas uses a centered 16:9 stage at an appropriate high-DPI resolution, while the engine remains in windowed mode; the optional fullscreen button uses browser fullscreen. After loading, click the game canvas to capture the mouse. Escape releases it, and another canvas click recaptures it. Browser events are forwarded through the WebAssembly mouse bridge rather than SDL's desktop relative-mouse path. Mobile/touch input and internet multiplayer are outside this version.

## Architecture and troubleshooting

- `src/engine.js` loads the generated ES module, downloads every PK3 listed in `public/engine/ioquake3-config.json`, reports real progress, mounts IDBFS, and starts the local match.
- `src/main.js` owns browser capability checks, the screen state machine, immediate user-gesture activation, pointer-lock recovery, fullscreen, and diagnostics.
- `scripts/prepare-assets.*` verifies and stages OpenArena without unpacking individual PK3 contents.
- `scripts/build-engine.ps1` checks the pinned ioquake3 revision and copies reproducible WebAssembly artifacts into Vite's public directory.

If the game reports a missing engine, run `npm run build:engine`. If it reports missing game data, run `npm run prepare:assets`. A corrupt download is rejected before extraction; delete `.cache/openarena-0.8.8.zip` and retry. Ensure static hosts serve `.wasm` as `application/wasm` and do not rewrite PK3 or WASM requests to `index.html`.

## Licensing and source availability

- The original `Quake-III-Arena/` tree is id Software's GPL source release and is retained as reference.
- `vendor/ioq3/` is pinned to commit `a66ff00250ec3834421c6af7340cda311bc1cbb4` from [ioquake3](https://github.com/ioquake/ioq3), licensed under GPL-2.0 with its bundled third-party notices.
- OpenArena 0.8.8 is a separate free-content game package. The setup script downloads the official release and verifies SHA-1 `37ab41990b37459822ce8c2fe590607616e1f6d1`.
- The Vite integration code in this repository is distributed under GPL-2.0-or-later so that the combined engine distribution remains straightforward to share and modify.

When distributing a built copy, include this repository's complete corresponding source, the ioquake3 source and notices, and the OpenArena license/source information shipped inside its release. OpenArena Web is not endorsed by id Software, Bethesda, ioquake3, or the OpenArena team.
