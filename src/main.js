import './style.css';
import { ArenaEngine } from './engine.js';

const canvas = document.querySelector('#game-canvas');
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
let engine = new ArenaEngine(canvas);
let launched = false;

function show(name) {
  Object.entries(screens).forEach(([key, element]) => element.classList.toggle('is-visible', key === name));
  canvas.classList.toggle('is-running', name === null);
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
}

function fail(error) {
  console.error(error);
  errorMessage.textContent = error?.message || String(error);
  show('error');
}

async function enterArena() {
  const unsupported = browserProblem();
  if (unsupported) return fail(new Error(unsupported));
  // Pointer lock and audio must be initiated synchronously from the Play gesture.
  // Browser user activation may expire while the large PK3 payload downloads.
  try {
    if (document.pointerLockElement !== canvas) await canvas.requestPointerLock();
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
    launched = true;
    if (document.pointerLockElement === canvas) show(null);
    else show('resume');
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

document.addEventListener('pointerlockchange', () => {
  if (!launched) return;
  if (document.pointerLockElement === canvas) show(null);
  else { engine.pause(); show('resume'); }
});
document.addEventListener('pointerlockerror', () => {
  if (launched) {
    engine.pause();
    show('resume');
  }
});
document.addEventListener('visibilitychange', () => {
  if (launched && document.hidden && document.pointerLockElement === canvas) document.exitPointerLock();
});

document.querySelector('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('#app').requestFullscreen();
  } catch (error) { fail(error); }
});
document.querySelector('#debug-button').addEventListener('click', () => { debugPanel.hidden = false; });
document.querySelector('#debug-close').addEventListener('click', () => { debugPanel.hidden = true; });

const blockedKeys = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
window.addEventListener('keydown', (event) => {
  if (document.pointerLockElement === canvas && blockedKeys.has(event.code)) event.preventDefault();
}, { passive: false });

bindEngine();
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
