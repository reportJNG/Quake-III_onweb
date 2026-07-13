import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateResolution, ResolutionController } from '../src/resolution.js';

test('calculates native and high-DPI drawing buffer sizes', () => {
  assert.deepEqual(calculateResolution(1920, 1080, 1), {
    cssWidth: 1920, cssHeight: 1080, width: 1920, height: 1080, pixelRatio: 1,
  });
  assert.deepEqual(calculateResolution(1280, 720, 1.5), {
    cssWidth: 1280, cssHeight: 720, width: 1920, height: 1080, pixelRatio: 1.5,
  });
});

test('clamps DPR and total backing-buffer dimensions', () => {
  assert.equal(calculateResolution(1920, 1080, 4).pixelRatio, 2);
  const large = calculateResolution(5120, 2880, 2);
  assert.equal(large.width, 5120);
  assert.equal(large.height, 2880);
  assert.equal(large.pixelRatio, 1);
});

test('supports ultrawide and portrait sizes without changing aspect ratio', () => {
  const ultrawide = calculateResolution(3440, 1440, 1.25);
  assert.equal(ultrawide.width / ultrawide.height, 3440 / 1440);
  const portrait = calculateResolution(720, 1280, 2);
  assert.equal(portrait.width, 1440);
  assert.equal(portrait.height, 2560);
});

test('rounds CSS sizes and ignores zero-sized containers', () => {
  assert.equal(calculateResolution(0, 720, 2), null);
  assert.equal(calculateResolution(1280, 0, 2), null);
  assert.equal(calculateResolution(799.6, 599.6, 1).cssWidth, 800);
});

test('controller synchronizes once, suppresses duplicates, and cleans up', () => {
  const windowTarget = new EventTarget();
  windowTarget.devicePixelRatio = 2;
  windowTarget.visualViewport = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.fullscreenElement = null;
  const canvas = { width: 0, height: 0, style: {} };
  const container = { getBoundingClientRect: () => ({ width: 800, height: 600 }) };
  let calls = 0;
  const frames = [];
  let observed = false;
  let disconnected = false;
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target) { observed = target === container; }
    disconnect() { disconnected = true; }
  }
  const controller = new ResolutionController(canvas, container, {
    windowTarget,
    documentTarget,
    ResizeObserver: Observer,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => {},
    onResize: () => { calls += 1; },
  });
  controller.start();
  assert.equal(observed, true);
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 1200);
  assert.equal(calls, 1);
  assert.equal(controller.sync(), false);
  assert.equal(calls, 1);
  windowTarget.dispatchEvent(new Event('resize'));
  windowTarget.dispatchEvent(new Event('resize'));
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(calls, 1);
  documentTarget.fullscreenElement = container;
  documentTarget.dispatchEvent(new Event('fullscreenchange'));
  frames.shift()();
  assert.equal(controller.getState().fullscreen, true);
  assert.equal(calls, 2);
  canvas.width = 640;
  assert.equal(controller.sync(), true);
  assert.equal(canvas.width, 1600);
  assert.equal(calls, 3);
  controller.lockBackingStore();
  canvas.width = 800;
  assert.equal(controller.sync(), false);
  assert.equal(canvas.width, 800);
  controller.dispose();
  assert.equal(disconnected, true);
  windowTarget.dispatchEvent(new Event('resize'));
  assert.equal(frames.length, 0);
});
