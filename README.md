# OpenArena Web

OpenArena Web runs the maintained ioquake3 engine in desktop browsers through WebAssembly. Vite supplies the small HTML, CSS, and JavaScript shell; OpenArena's game code, bots, renderer, input, and audio remain native id Tech 3 code compiled with Emscripten.

The repository does not include retail Quake III data. Asset preparation downloads the freely redistributable OpenArena 0.8.8 release, verifies its official SHA-1, and stages the PK3 files for the web build.

## Requirements

- Node.js 20.19+ or 22.12+
- Git with submodule support
- CMake 3.24+ and Ninja, either on `PATH` or under `vendor/`
- Emscripten SDK 4.0.19
- A current desktop Chrome, Edge, or Firefox browser

Clone with the pinned ioquake3 source:

```bash
git clone --recurse-submodules <repository-url>
cd quake
npm install
```

For an existing clone, run `git submodule update --init` before building the engine.

## Windows setup

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-emsdk.ps1
$env:EMSDK="$PWD\vendor\emsdk"
& "$env:EMSDK\emsdk_env.ps1"
npm run prepare:assets
npm run build:engine
npm run dev
```

Open the URL printed by Vite and click **Play**. The first asset preparation downloads approximately 426 MiB. To reuse an existing verified archive:

```powershell
npm run prepare:assets -- -Archive "C:\path\to\openarena-0.8.8.zip"
```

Use `npm run build:engine -- -Clean` for a clean native rebuild.

## Linux and macOS setup

Install Node.js, CMake, Ninja, `curl`, `unzip`, and `sha1sum`, then install and activate Emscripten SDK 4.0.19.

```bash
./scripts/prepare-assets.sh

# Export and patch the pinned engine without modifying the submodule.
mkdir -p .cache/ioq3-source
git -C vendor/ioq3 archive a66ff00250ec3834421c6af7340cda311bc1cbb4 | tar -x -C .cache/ioq3-source
git apply --directory=.cache/ioq3-source patches/ioq3-web-mouse.patch

emcmake cmake -S .cache/ioq3-source -B .cache/ioq3-wasm \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_CLIENT=ON -DBUILD_SERVER=OFF \
  -DBUILD_GAME_LIBRARIES=OFF -DBUILD_GAME_QVMS=OFF -DUSE_OPENAL=OFF \
  -DUSE_VOIP=OFF -DUSE_MUMBLE=OFF -DUSE_CODEC_OPUS=OFF
cmake --build .cache/ioq3-wasm --parallel
cp .cache/ioq3-wasm/Release/ioquake3.{js,wasm} public/engine/
npm run dev
```

The engine output directory can vary by CMake generator. Copy `ioquake3.js` and `ioquake3.wasm` from the generated Release directory when necessary.

## Controls and browser behavior

- WASD: move
- Mouse: aim; left button fires
- Space: jump
- 1–9 or mouse wheel: weapons
- Tab: scoreboard
- Escape: release the pointer

Click **Play** to open the native OpenArena menu. Select maps, modes, bots, difficulty, and match limits inside the game UI. Click the canvas to capture the mouse; Escape releases it, and another click recaptures it. Fullscreen and engine-log controls appear in the top-right while the engine is running.

The game must be served over HTTP(S), not opened through `file://`. It requires WebAssembly, WebGL 2, Web Audio, and Pointer Lock. Mobile/touch input and internet multiplayer are not supported.

## Verification and production deployment

```bash
npm run verify
npm run build
npm run preview
```

Deploy the generated `dist/` directory to a static host. `vite preview` is for local verification, not production serving. Root deployments need no additional configuration. For a nested deployment such as `/quake/`, build with:

```powershell
$env:VITE_BASE_PATH='/quake/'
npm run build
```

The base path must begin and end with `/`. The engine, manifest, PK3, JavaScript, and CSS URLs all follow this setting. Hosts must serve `.wasm` as `application/wasm` and must not rewrite engine, PK3, or WASM requests to `index.html`. `public/_headers` supplies MIME and cache guidance on hosts that support that format; configure equivalent headers elsewhere.

## Architecture and troubleshooting

- `src/engine.js` loads the generated engine, downloads the manifest's PK3 files with bounded concurrency, mounts IDBFS, and connects browser mouse events to native exports.
- `src/main.js` owns capability checks, screen state, pointer-lock recovery, fullscreen, responsive resolution, and diagnostics.
- `scripts/prepare-assets.*` verify and stage OpenArena data, while `scripts/manifest.mjs` produces a deterministic size-aware manifest.
- `scripts/build-engine.ps1` exports the pinned clean ioquake3 source, applies `patches/ioq3-web-mouse.patch` in `.cache`, and verifies the resulting WebAssembly exports.

If the engine is missing, run `npm run build:engine`. If game data is missing, run `npm run prepare:assets`. A corrupt archive is rejected before extraction; remove `.cache/openarena-0.8.8.zip` and retry. If mouse capture is denied, click the canvas again and confirm Pointer Lock is permitted for the site.

## Licensing

The web integration and ioquake3 are GPL-2.0-or-later compatible; see `LICENSE`, `vendor/ioq3/COPYING.txt`, and `THIRD_PARTY.md`. OpenArena content retains its own copyright and license notices inside the verified release.

When distributing a built copy, provide the corresponding integration source, the pinned ioquake3 source and applied patch, ioquake3 notices, and the OpenArena license/source information. OpenArena Web is not endorsed by id Software, Bethesda, ioquake3, or the OpenArena team.
