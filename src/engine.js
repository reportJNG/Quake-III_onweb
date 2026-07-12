import { GAME_CONFIG, startupArguments } from './config.js';

const MAX_LOG_LINES = 400;

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
    if (this.module) return this.module;
    if (this.loading) return this.loading;
    this.loading = this.#load();
    return this.loading;
  }

  async #load() {
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
    try {
      this.module = await factory({
        canvas: this.canvas,
        arguments: startupArguments(this.config),
        locateFile: (file) => new URL(file, engineDir).href,
        print: (text) => this.log(text, 'stdout'),
        printErr: (text) => this.log(text, 'stderr'),
        onAbort: (reason) => this.emit('fatal-error', { error: new Error(String(reason)) }),
        preRun: [async (module) => this.#prepareFilesystem(module, files)],
      });
      this.emit('state', { state: 'ready' });
      return this.module;
    } catch (error) {
      this.emit('fatal-error', { error });
      throw error;
    }
  }

  async #fetchJson(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
    return response.json();
  }

  async #importEngineModule() {
    const response = await fetch(this.config.engineUrl, { cache: 'no-cache' });
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
      const total = files.length;
      const fetches = files.map((file) => this.#fetchAsset(file, module, (loaded, size) => {
        const fractional = size ? loaded / size : 0;
        this.emit('progress', {
          loaded: completed + fractional,
          total,
          label: `Loading ${file.src.split('/').pop()}…`,
        });
      }).then(() => {
        completed += 1;
        this.emit('progress', { loaded: completed, total, label: `Loaded ${completed} of ${total} game files` });
      }));
      await Promise.all(fetches);
      await this.#syncFilesystem(module, false);
    } finally {
      module.removeRunDependency('setup-openarena-filesystem');
    }
  }

  async #fetchAsset(file, module, onProgress) {
    const url = new URL(file.src, new URL(this.config.dataBaseUrl, location.href));
    const response = await fetch(url);
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

  async start({ captureMouse = true } = {}) {
    await this.load();
    if (captureMouse) await this.resume();
    this.emit('state', { state: 'running' });
  }

  pause() {
    this.emit('state', { state: 'paused' });
  }

  async resume() {
    await ArenaEngine.resumeAudio();
    this.canvas.focus();
    if (document.pointerLockElement !== this.canvas) await this.canvas.requestPointerLock();
    this.emit('state', { state: 'running' });
  }

  setVolume(value) {
    this.config = { ...this.config, volume: Math.max(0, Math.min(1, Number(value))) };
    this.log(`Volume set to ${this.config.volume}; apply in console with s_volume if match is running.`);
  }

  static async resumeAudio() {
    const contexts = [window.SDL?.audioContext, window.AL?.currentContext?.ctx].filter(Boolean);
    await Promise.all(contexts.map((context) => context.state === 'suspended' ? context.resume() : undefined));
  }

  dispose() {
    this.disposed = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.module?.quit?.();
    this.module = null;
    this.loading = null;
  }
}
