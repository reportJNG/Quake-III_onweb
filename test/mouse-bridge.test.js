import assert from 'node:assert/strict';
import test from 'node:test';
import { connectMouseCapture, connectNativeMouseBridge } from '../src/engine.js';

function mouseEvent(type, values) {
  return Object.assign(new Event(type, { cancelable: true }), values);
}

test('forwards locked browser mouse input directly to native exports', () => {
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  const canvas = { ownerDocument: doc };
  const calls = [];
  const module = {
    _IN_WebSetPointerLock: (active) => calls.push(['lock', active]),
    _IN_WebInjectMouseMove: (x, y) => calls.push(['move', x, y]),
    _IN_WebInjectMouseButton: (button, down) => calls.push(['button', button, down]),
    _IN_WebInjectMouseWheel: (direction) => calls.push(['wheel', direction]),
  };

  const disconnect = connectNativeMouseBridge(canvas, module);
  assert.deepEqual(calls, [['lock', 0]]);

  doc.dispatchEvent(mouseEvent('mousemove', { movementX: 2, movementY: 3 }));
  assert.equal(calls.length, 1, 'movement is ignored before pointer lock');

  doc.pointerLockElement = canvas;
  doc.dispatchEvent(new Event('pointerlockchange'));
  doc.dispatchEvent(mouseEvent('mousemove', { movementX: 12, movementY: -7 }));
  doc.dispatchEvent(mouseEvent('mousedown', { button: 0 }));
  doc.dispatchEvent(mouseEvent('mouseup', { button: 0 }));
  doc.dispatchEvent(mouseEvent('mousedown', { button: 1 }));
  doc.dispatchEvent(mouseEvent('mouseup', { button: 1 }));
  doc.dispatchEvent(mouseEvent('mousedown', { button: 2 }));
  doc.dispatchEvent(mouseEvent('mouseup', { button: 2 }));
  const wheel = mouseEvent('wheel', { deltaY: -100 });
  doc.dispatchEvent(wheel);
  doc.dispatchEvent(mouseEvent('wheel', { deltaY: 100 }));
  const contextMenu = mouseEvent('contextmenu', {});
  doc.dispatchEvent(contextMenu);

  assert.deepEqual(calls, [
    ['lock', 0],
    ['lock', 1],
    ['move', 12, -7],
    ['button', 0, 1],
    ['button', 0, 0],
    ['button', 1, 1],
    ['button', 1, 0],
    ['button', 2, 1],
    ['button', 2, 0],
    ['wheel', 1],
    ['wheel', -1],
  ]);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(contextMenu.defaultPrevented, true);

  doc.pointerLockElement = null;
  doc.dispatchEvent(new Event('pointerlockchange'));
  disconnect();
  doc.dispatchEvent(mouseEvent('mousemove', { movementX: 1, movementY: 1 }));
  assert.deepEqual(calls.at(-1), ['lock', 0]);
});

test('captures from a canvas click and survives release, fullscreen, focus, and visibility changes', async () => {
  const doc = new EventTarget();
  const win = new EventTarget();
  const canvas = new EventTarget();
  doc.pointerLockElement = null;
  doc.hidden = false;
  canvas.ownerDocument = doc;
  let focusCalls = 0;
  let lockCalls = 0;
  let releases = 0;
  let activations = 0;
  const states = [];
  const errors = [];
  canvas.focus = () => { focusCalls += 1; };
  canvas.requestPointerLock = () => {
    lockCalls += 1;
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  doc.exitPointerLock = () => {
    releases += 1;
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };

  const capture = connectMouseCapture(canvas, {
    documentTarget: doc,
    windowTarget: win,
    activate: () => { activations += 1; },
    onChange: (locked) => states.push(locked),
    onError: (error) => errors.push(error),
  });
  assert.deepEqual(states, [false]);

  canvas.dispatchEvent(new Event('click'));
  await Promise.resolve();
  assert.equal(doc.pointerLockElement, canvas);
  assert.equal(focusCalls, 1);
  assert.equal(lockCalls, 1);
  assert.equal(activations, 1);
  assert.deepEqual(states, [false, true]);

  doc.dispatchEvent(new Event('fullscreenchange'));
  win.dispatchEvent(new Event('focus'));
  assert.deepEqual(states.slice(-2), [true, true]);

  win.dispatchEvent(new Event('blur'));
  assert.equal(releases, 1);
  assert.equal(doc.pointerLockElement, null);
  assert.equal(states.at(-1), false);

  canvas.dispatchEvent(new Event('click'));
  await Promise.resolve();
  assert.equal(lockCalls, 2, 'a later canvas click recaptures the mouse');

  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(releases, 2);
  assert.equal(states.at(-1), false);
  assert.deepEqual(errors, []);

  capture.disconnect();
  canvas.dispatchEvent(new Event('click'));
  win.dispatchEvent(new Event('focus'));
  assert.equal(lockCalls, 2, 'disconnect removes the canvas capture listener');
  assert.equal(states.at(-1), false, 'disconnect removes focus synchronization');
});

test('reports synchronous and asynchronous pointer-lock failures', async () => {
  const doc = new EventTarget();
  const win = new EventTarget();
  const errors = [];
  doc.pointerLockElement = null;
  const canvas = new EventTarget();
  canvas.focus = () => {};
  canvas.requestPointerLock = () => Promise.reject(new Error('denied'));

  const capture = connectMouseCapture(canvas, {
    documentTarget: doc,
    windowTarget: win,
    onError: (error) => errors.push(error.message),
  });
  await assert.rejects(capture.capture(), /denied/);
  assert.deepEqual(errors, ['denied']);
  capture.disconnect();
});

test('rejects an engine artifact without the native bridge exports', () => {
  const doc = new EventTarget();
  const canvas = { ownerDocument: doc };
  assert.throws(
    () => connectNativeMouseBridge(canvas, {}),
    /does not expose the native mouse bridge/,
  );
});
