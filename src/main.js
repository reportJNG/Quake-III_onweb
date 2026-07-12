import './style.css';
import { ArenaEngine } from './engine.js';
import { ResolutionController } from './resolution.js';

const canvas = document.querySelector('#game-canvas');
const app = document.querySelector('#app');
const gameStage = document.querySelector('#game-stage');
const screens = Object.fromEntries(['landing', 'loading', 'resume', 'error'].map((id) => [id, document.querySelector(`#${id}`)]));
const playButton = document.querySelector('#play-button');
const resumeButton = document.querySelector('#resume-button');
const retryButton = document.querySelector('#retry-button');
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const errorMessage = document.querySelector('#error-message');
const hudTools = document.querySelector('#hud-tools');
const debugPanel = document.querySelector('#debug-panel');
const debugOutput = document.querySelector('#debug-output');
const fullscreenButton = document.querySelector('#fullscreen-button');
let engine = new ArenaEngine(canvas);
let launched = false;
const resolution = new ResolutionController(canvas, gameStage, {
  dprLimit: 2,
  onResize: (detail) => engine.resize(detail),
});

function show(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('is-visible', key === name));
  canvas.classList.toggle('is-running', name === null || (launched && name === 'resume'));
  hudTools.hidden = !launched;
}

function browserProblem() {
  if (location.protocol === 'file:') return 'This game must be served over HTTP. Run npm run dev and open the shown address.';
  if (!window.WebAssembly) return 'This browser does not support WebAssembly.';
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return 'WebGL 2 is unavailable. Enable hardware acceleration or use a supported desktop browser.';
  if (!('pointerLockElement' in document)) return 'Pointer Lock is unavailable in this browser.';
  return null;
}

function bindEngine() {
  engine.addEventListener('progress', ({ detail }) => {
    const ratio = detail.total ? detail.loaded / detail.total : 0;
    progressBar.style.width = `${Math.max(2, Math.min(100, ratio * 100))}%`;
    progressLabel.textContent = detail.label;
  });
  engine.addEventListener('log', ({ detail }) => {
    debugOutput.textContent = detail.lines.join('\n');
    debugOutput.scrollTop = debugOutput.scrollHeight;
  });
  engine.addEventListener('fatal-error', ({ detail }) => fail(detail.error));
  engine.addEventListener('capturechange', ({ detail }) => {
    if (!launched) return;
    if (detail.locked) show(null);
    else { engine.pause(); show('resume'); }
  });
  engine.addEventListener('captureerror', ({ detail }) => {
    if (!launched) return;
    console.warn(`Mouse capture was denied: ${detail.error.message}`);
    engine.pause();
    show('resume');
  });
}

function fail(error) {
  console.error(error);
  errorMessage.textContent = error?.message || String(error);
  show('error');
}

async function enterArena() {
  const unsupported = browserProblem();
  if (unsupported) return fail(new Error(unsupported));
  // Unlock audio from the initial gesture, but do not capture the mouse yet.
  // SDL installs its mouse listeners while the engine loads; capturing earlier
  // means it can miss the pointer-lock transition and receive no mouse movement.
  try {
    const UnlockContext = window.AudioContext || window.webkitAudioContext;
    if (UnlockContext) {
      const unlock = new UnlockContext();
      await unlock.resume();
      await unlock.close();
    }
  } catch (error) {
    console.warn(`Mouse or audio activation was deferred: ${error.message}`);
  }
  show('loading');
  playButton.disabled = true;
  try {
    await engine.start({ captureMouse: false });
    resolution.sync();
    launched = true;
    // Show the native UI immediately. The player's first real click on the
    // canvas is handled by Emscripten and enables SDL relative mouse mode.
    show(null);
  } catch (error) {
    fail(error);
  } finally {
    playButton.disabled = false;
  }
}

playButton.addEventListener('click', enterArena);
resumeButton.addEventListener('click', async () => {
  try {
    await engine.resume();
    show(null);
  } catch (error) {
    console.warn(`Mouse capture was denied: ${error.message}`);
    engine.pause();
    show('resume');
  }
});
retryButton.addEventListener('click', () => location.reload());

function updateFullscreenButton() {
  const active = document.fullscreenElement === app;
  fullscreenButton.textContent = active ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  fullscreenButton.setAttribute('aria-pressed', String(active));
}

fullscreenButton.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await app.requestFullscreen({ navigationUI: 'hide' });
  } catch (error) {
    console.warn(`Fullscreen was unavailable: ${error.message}`);
    updateFullscreenButton();
  }
});
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.querySelector('#debug-button').addEventListener('click', () => { debugPanel.hidden = false; });
document.querySelector('#debug-close').addEventListener('click', () => { debugPanel.hidden = true; });

const blockedKeys = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
window.addEventListener('keydown', (event) => {
  if (document.pointerLockElement === canvas && blockedKeys.has(event.code)) event.preventDefault();
}, { passive: false });

bindEngine();
resolution.start();
updateFullscreenButton();
if (import.meta.hot) import.meta.hot.dispose(() => {
  resolution.dispose();
  document.removeEventListener('fullscreenchange', updateFullscreenButton);
  engine.dispose();
});
