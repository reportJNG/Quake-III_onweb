import { GAME_CONFIG, startupArguments } from './config.js';

const MAX_LOG_LINES = 400;
const ASSET_CONCURRENCY = 2;

export async function mapWithConcurrency(items, limit, worker) {
  const queue = Array.from(items);
  const workerCount = Math.max(1, Math.min(queue.length, Math.floor(Number(limit)) || 1));
  let nextIndex = 0;
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(queue[index], index);
    }
  });
  await Promise.all(runners);
}

export function createAssetProgress(files, emit) {
  const loadedByFile = files.map(() => 0);
  const declaredSizes = files.map((file) => Number(file.size) || 0);
  const usesBytes = declaredSizes.every((size) => size > 0);
  const total = usesBytes ? declaredSizes.reduce((sum, size) => sum + size, 0) : files.length;
  const loaded = () => loadedByFile.reduce((sum, value) => sum + value, 0);
  return {
    total,
    usesBytes,
    update(index, received, responseSize) {
      loadedByFile[index] = usesBytes
        ? Math.min(received, declaredSizes[index])
        : (responseSize ? Math.min(1, received / responseSize) : 0);
      emit({
        loaded: loaded(),
        total,
        label: `Loading ${files[index].src.split('/').pop()}…`,
      });
    },
    complete(index, completed) {
      loadedByFile[index] = usesBytes ? declaredSizes[index] : 1;
      emit({
        loaded: loaded(),
        total,
        label: `Loaded ${completed} of ${files.length} game files`,
      });
    },
  };
}

export function connectNativeMouseBridge(canvas, module, log = () => {}) {
  const doc = canvas.ownerDocument || document;
  const native = {
    lock: module?._IN_WebSetPointerLock,
    move: module?._IN_WebInjectMouseMove,
    button: module?._IN_WebInjectMouseButton,
    wheel: module?._IN_WebInjectMouseWheel,
  };
  if (Object.values(native).some((fn) => typeof fn !== 'function')) {
    throw new Error('The WebAssembly engine does not expose the native mouse bridge. Rebuild the engine.');
  }

  const locked = () => doc.pointerLockElement === canvas;
  const onPointerLock = () => native.lock(locked() ? 1 : 0);
  const onMouseMove = (event) => {
    if (locked()) native.move(event.movementX || 0, event.movementY || 0);
  };
  const onMouseDown = (event) => {
    if (locked()) native.button(event.button, 1);
  };
  const onMouseUp = (event) => {
    if (locked()) native.button(event.button, 0);
  };
  const onWheel = (event) => {
    if (!locked() || event.deltaY === 0) return;
    native.wheel(event.deltaY < 0 ? 1 : -1);
    event.preventDefault();
  };
  const onContextMenu = (event) => {
    if (locked() || event.target === canvas) event.preventDefault();
  };

  doc.addEventListener('pointerlockchange', onPointerLock, true);
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('mousedown', onMouseDown, true);
  doc.addEventListener('mouseup', onMouseUp, true);
  doc.addEventListener('wheel', onWheel, { capture: true, passive: false });
  doc.addEventListener('contextmenu', onContextMenu, true);
  onPointerLock();
  log('Mouse bridge connected directly to the native game.');

  return () => {
    doc.removeEventListener('pointerlockchange', onPointerLock, true);
    doc.removeEventListener('mousemove', onMouseMove, true);
    doc.removeEventListener('mousedown', onMouseDown, true);
    doc.removeEventListener('mouseup', onMouseUp, true);
    doc.removeEventListener('wheel', onWheel, true);
    doc.removeEventListener('contextmenu', onContextMenu, true);
  };
}

export function connectMouseCapture(canvas, options = {}) {
  const doc = options.documentTarget || canvas.ownerDocument || document;
  const win = options.windowTarget || doc.defaultView || window;
  const onChange = options.onChange || (() => {});
  const onError = options.onError || (() => {});
  const activate = options.activate || (() => {});
  let disposed = false;

  const locked = () => doc.pointerLockElement === canvas;
  const sync = () => onChange(locked());
  const release = () => {
    if (locked()) doc.exitPointerLock();
  };
  const capture = () => {
    if (disposed) return Promise.resolve();
    try {
      if (locked()) return Promise.resolve(activate()).then(() => undefined);
      try {
        canvas.focus({ preventScroll: true });
      } catch {
        canvas.focus();
      }
      // This must happen before any await so the browser user gesture remains valid.
      const lockRequest = canvas.requestPointerLock();
      const activation = activate();
      return Promise.all([Promise.resolve(lockRequest), Promise.resolve(activation)])
        .then(() => undefined)
        .catch((error) => {
          onError(error);
          throw error;
        });
    } catch (error) {
      onError(error);
      return Promise.reject(error);
    }
  };
  const onCanvasClick = () => {
    capture().catch(() => {});
  };
  const onPointerLockError = () => onError(new Error('The browser denied mouse capture.'));
  const onVisibilityChange = () => {
    if (doc.hidden) release();
    else sync();
  };

  canvas.addEventListener('click', onCanvasClick);
  doc.addEventListener('pointerlockchange', sync);
  doc.addEventListener('pointerlockerror', onPointerLockError);
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  win.addEventListener('focus', sync);
  win.addEventListener('blur', release);
  sync();

  return {
    capture,
    release,
    disconnect() {
      disposed = true;
      canvas.removeEventListener('click', onCanvasClick);
      doc.removeEventListener('pointerlockchange', sync);
      doc.removeEventListener('pointerlockerror', onPointerLockError);
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      win.removeEventListener('focus', sync);
      win.removeEventListener('blur', release);
    },
  };
}

export class ArenaEngine extends EventTarget {
  constructor(canvas, config = GAME_CONFIG) {
    super();
    this.canvas = canvas;
    this.config = config;
    this.module = null;
    this.factory = null;
    this.loading = null;
    this.disposed = false;
    this.logs = [];
    this.mouseBridge = null;
    this.mouseCapture = null;
    this.abortController = null;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  log(message, kind = 'stdout') {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
    this.emit('log', { line, kind, lines: this.logs });
    (kind === 'stderr' ? console.error : console.log)(message);
  }

  async load() {
    if (this.disposed) throw new Error('The game engine has been disposed.');
    if (this.module) return this.module;
    if (this.loading) return this.loading;
    this.loading = this.#load().catch((error) => {
      this.#unbindMouseCapture();
      this.#unbindMouseBridge();
      this.module = null;
      this.factory = null;
      throw error;
    }).finally(() => {
      this.loading = null;
      this.abortController = null;
    });
    return this.loading;
  }

  async #load() {
    this.abortController = new AbortController();
    this.emit('state', { state: 'loading' });
    this.emit('progress', { loaded: 0, total: 1, label: 'Loading engine module…' });
    let factory;
    try {
      factory = (await this.#importEngineModule()).default;
    } catch (error) {
      throw new Error(`The WebAssembly engine is missing. Run \"npm run setup\" first. (${error.message})`);
    }
    if (typeof factory !== 'function') throw new Error('The generated ioquake3 module is invalid.');
    this.factory = factory;
    const manifest = await this.#fetchJson(this.config.configUrl);
    const files = manifest[this.config.baseGame]?.files;
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error(`No ${this.config.baseGame} files are listed in the engine manifest.`);
    }

    const engineBase = new URL(this.config.engineUrl, location.href);
    const engineDir = new URL('.', engineBase).href;
    this.module = await factory({
      canvas: this.canvas,
      // Browser-side capture is managed explicitly after the engine is ready.
      elementPointerLock: false,
      arguments: startupArguments(this.config),
      locateFile: (file) => {
        const url = new URL(file, engineDir);
        if (this.config.engineRevision) url.searchParams.set('v', this.config.engineRevision);
        return url.href;
      },
      print: (text) => this.log(text, 'stdout'),
      printErr: (text) => this.log(text, 'stderr'),
      onAbort: (reason) => {
        const error = new Error(String(reason));
        if (this.module) this.emit('fatal-error', { error });
        else this.log(`Engine initialization aborted: ${error.message}`, 'stderr');
      },
      preRun: [async (module) => this.#prepareFilesystem(module, files)],
    });
    this.#bindMouseBridge();
    this.#bindMouseCapture();
    this.emit('state', { state: 'ready' });
    return this.module;
  }

  async #fetchJson(url) {
    const response = await fetch(url, { cache: 'no-cache', signal: this.abortController?.signal });
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return response.json();
  }

  async #importEngineModule() {
    const engineUrl = new URL(this.config.engineUrl, location.href);
    if (this.config.engineRevision) engineUrl.searchParams.set('v', this.config.engineRevision);
    const response = await fetch(engineUrl, { cache: 'no-cache', signal: this.abortController?.signal });
    if (!response.ok) throw new Error(`Could not load ${this.config.engineUrl} (${response.status}).`);
    const source = await response.text();
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async #prepareFilesystem(module, files) {
    module.addRunDependency('setup-openarena-filesystem');
    try {
      await this.#mountPersistence(module);
      let completed = 0;
      const progress = createAssetProgress(files, (detail) => this.emit('progress', detail));
      await mapWithConcurrency(files, ASSET_CONCURRENCY, async (file, index) => {
        await this.#fetchAsset(file, module, (loaded, responseSize) => {
          progress.update(index, loaded, responseSize);
        });
        completed += 1;
        progress.complete(index, completed);
      });
      await this.#syncFilesystem(module, false);
    } finally {
      module.removeRunDependency('setup-openarena-filesystem');
    }
  }

  async #fetchAsset(file, module, onProgress) {
    const url = new URL(file.src, new URL(this.config.dataBaseUrl, location.href));
    const response = await fetch(url, { signal: this.abortController?.signal });
    if (!response.ok) throw new Error(`Missing game data: ${file.src} (${response.status}).`);
    const size = Number(response.headers.get('content-length')) || 0;
    let bytes;
    if (response.body && size) {
      const reader = response.body.getReader();
      const chunks = [];
      let loaded = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.length; onProgress(loaded, size);
      }
      bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      onProgress(bytes.length, bytes.length);
    }
    if (Number(file.size) > 0 && bytes.length !== Number(file.size)) {
      throw new Error(`Game data size mismatch for ${file.src}: expected ${file.size}, received ${bytes.length}.`);
    }
    const name = file.src.split('/').pop();
    module.FS.mkdirTree(file.dst);
    module.FS.writeFile(`${file.dst}/${name}`, bytes);
  }

  async #mountPersistence(module) {
    if (!module.IDBFS) {
      this.log('IDBFS is unavailable; settings will last for this session only.', 'stderr');
      return;
    }
    const home = '/openarena-web';
    module.FS.mkdirTree(home);
    try {
      module.FS.mount(module.IDBFS, {}, home);
      await this.#syncFilesystem(module, true);
      const marker = `${home}/.fs-version`;
      const current = module.FS.analyzePath(marker).exists ? module.FS.readFile(marker, { encoding: 'utf8' }) : '';
      if (current !== String(this.config.filesystemVersion)) {
        module.FS.writeFile(marker, String(this.config.filesystemVersion));
      }
    } catch (error) {
      this.log(`Persistent storage unavailable: ${error.message}`, 'stderr');
    }
  }

  #syncFilesystem(module, populate) {
    return new Promise((resolve) => {
      if (!module.FS?.syncfs) return resolve();
      module.FS.syncfs(populate, (error) => {
        if (error) this.log(`Filesystem sync failed: ${error.message || error}`, 'stderr');
        resolve();
      });
    });
  }

  #bindMouseBridge() {
    this.#unbindMouseBridge();
    this.mouseBridge = connectNativeMouseBridge(this.canvas, this.module, (message) => this.log(message));
  }

  #unbindMouseBridge() {
    if (!this.mouseBridge) return;
    this.mouseBridge();
    this.mouseBridge = null;
  }

  #bindMouseCapture() {
    this.#unbindMouseCapture();
    this.mouseCapture = connectMouseCapture(this.canvas, {
      activate: () => ArenaEngine.resumeAudio(),
      onChange: (locked) => this.emit('capturechange', { locked }),
      onError: (error) => this.emit('captureerror', { error }),
    });
  }

  #unbindMouseCapture() {
    if (!this.mouseCapture) return;
    this.mouseCapture.disconnect();
    this.mouseCapture = null;
  }

  async start({ captureMouse = true } = {}) {
    await this.load();
    if (captureMouse) await this.resume();
    this.emit('state', { state: 'running' });
  }

  resize(detail) {
    if (!this.module) return;
    this.log(`Display resized to ${detail.width}x${detail.height} (${detail.cssWidth}x${detail.cssHeight} CSS pixels).`);
    // Emscripten's SDL backend updates its window, GL viewport, and input scale
    // from the browser resize event after the canvas backing store is changed.
    window.dispatchEvent(new Event('resize'));
  }

  pause() {
    this.emit('state', { state: 'paused' });
  }

  async resume() {
    if (!this.mouseCapture) await this.load();
    await this.mouseCapture.capture();
    this.emit('state', { state: 'running' });
  }

  static async resumeAudio() {
    const contexts = [window.SDL?.audioContext, window.AL?.currentContext?.ctx].filter(Boolean);
    await Promise.all(contexts.map((context) => context.state === 'suspended' ? context.resume() : undefined));
  }

  dispose() {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    this.#unbindMouseCapture();
    this.#unbindMouseBridge();
    const doc = this.canvas.ownerDocument || globalThis.document;
    if (doc?.pointerLockElement === this.canvas) doc.exitPointerLock();
    this.module?.quit?.();
    this.module = null;
    this.loading = null;
  }
}
