import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const targetUrl = process.argv[2] || 'http://127.0.0.1:5173/';
const maxWaitSeconds = Number(process.env.SMOKE_WAIT_SECONDS) || 120;
const debugPort = 9333;
const profile = resolve(tmpdir(), `webarena-smoke-${process.pid}`);
const screenshotPath = resolve(root, '.cache/webarena-smoke.png');
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

let server;
if (!process.argv[2]) {
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore',
  });
  let reachable = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) { reachable = true; break; }
    } catch {}
    await delay(250);
  }
  if (!reachable) {
    server.kill();
    throw new Error('The local Vite server did not become ready.');
  }
}

const candidates = process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

let chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  for (const candidate of candidates) {
    try { await access(candidate); chromePath = candidate; break; } catch {}
  }
}
if (!chromePath) throw new Error('Chrome was not found. Set CHROME_PATH to run the gameplay smoke test.');

await mkdir(profile, { recursive: true });
await mkdir(resolve(screenshotPath, '..'), { recursive: true });
const chrome = spawn(chromePath, [
  '--headless=new',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required',
  '--enable-webgl',
  '--window-size=1440,900',
  targetUrl,
], { stdio: 'ignore' });

async function browserTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const target = targets.find((item) => item.type === 'page' && item.url.startsWith(targetUrl));
      if (target) return target;
    } catch {}
    await delay(250);
  }
  throw new Error('Chrome DevTools did not expose the game page.');
}

let socket;
try {
  const target = await browserTarget();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  const browserMessages = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.consoleAPICalled') {
      browserMessages.push(message.params.args.map((argument) => argument.value || argument.description || '').join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      browserMessages.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveCall, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolveCall(message.result);
  });
  const call = (method, params = {}) => new Promise((resolveCall, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolveCall, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  };

  await call('Runtime.enable');
  await call('Page.enable');
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    ready = await evaluate(`document.querySelector('#app')?.dataset.ready === 'true'`);
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw new Error('The game landing screen did not become ready.');
  await delay(1000);
  await evaluate(`document.querySelector('#play-button').click()`);

  let state;
  let initialized = false;
  for (let attempt = 0; attempt < maxWaitSeconds; attempt += 1) {
    state = await evaluate(`(() => ({
      running: document.querySelector('#game-canvas').classList.contains('is-running'),
      failed: document.querySelector('#error').classList.contains('is-visible'),
      landing: document.querySelector('#landing').classList.contains('is-visible'),
      loading: document.querySelector('#loading').classList.contains('is-visible'),
      playDisabled: document.querySelector('#play-button').disabled,
      error: document.querySelector('#error-message').textContent,
      log: document.querySelector('#debug-output').textContent
    }))()`);
    if (state.failed) throw new Error(state.error || 'The game entered its error screen.');
    if (state.running && /Client Initialization Complete|CL_InitCGame|active action/i.test(state.log)) {
      initialized = true;
      break;
    }
    await delay(1000);
  }
  if (!state?.running || !initialized) {
    console.error(JSON.stringify(state, null, 2));
    console.error(browserMessages.join('\n'));
    console.error(state?.log || 'No native engine log was captured.');
    throw new Error(`The game did not enter the arena within ${maxWaitSeconds} seconds.`);
  }
  await delay(10000);
  state = await evaluate(`(() => ({
    running: document.querySelector('#game-canvas').classList.contains('is-running'),
    error: document.querySelector('#error-message').textContent,
    log: document.querySelector('#debug-output').textContent
  }))()`);
  if (/recursive error after|couldn't compile shader|ERROR:.*Hunk_|Sys_Error/i.test(state.log)) {
    throw new Error('The native engine log contains a fatal renderer or memory error.');
  }
  if (!/loaded skill 5 from bots\/(sergei|major|penguin|skelebot|grunt)_c\.c|(?:Assassin|Major|Penguin|Skelebot|Grunt)\^7/i.test(state.log)) {
    console.error(state.log.split('\n').slice(-220).join('\n'));
    throw new Error('No curated hard bot entered the match.');
  }
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  console.log(state.log.split('\n').slice(-180).join('\n'));
  console.log(`Gameplay smoke test passed. Screenshot: ${screenshotPath}`);
} finally {
  try { socket?.close(); } catch {}
  chrome.kill();
  server?.kill();
  await delay(500);
  await rm(profile, { recursive: true, force: true });
}
