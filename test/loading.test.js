import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaEngine, createAssetProgress, mapWithConcurrency } from '../src/engine.js';
import { GAME_CONFIG } from '../src/config.js';

test('limits concurrent asset work and visits every item', async () => {
  let active = 0;
  let maximum = 0;
  const visited = [];
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    visited.push(item);
    active -= 1;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(visited.sort(), [1, 2, 3, 4, 5]);
});

test('reports aggregate byte progress and falls back to file units', () => {
  const byteEvents = [];
  const byteProgress = createAssetProgress([
    { src: 'baseoa/a.pk3', size: 100 },
    { src: 'baseoa/b.pk3', size: 300 },
  ], (detail) => byteEvents.push(detail));
  assert.equal(byteProgress.total, 400);
  assert.equal(byteProgress.usesBytes, true);
  byteProgress.update(0, 50, 100);
  byteProgress.update(1, 75, 300);
  assert.equal(byteEvents.at(-1).loaded, 125);
  byteProgress.complete(0, 1);
  assert.equal(byteEvents.at(-1).loaded, 175);

  const fileEvents = [];
  const fileProgress = createAssetProgress([
    { src: 'baseoa/a.pk3' },
    { src: 'baseoa/b.pk3' },
  ], (detail) => fileEvents.push(detail));
  assert.equal(fileProgress.total, 2);
  assert.equal(fileProgress.usesBytes, false);
  fileProgress.update(0, 25, 100);
  fileProgress.complete(1, 1);
  assert.equal(fileEvents.at(-1).loaded, 1.25);
});

test('clears a failed load so a later attempt can retry', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = globalThis.location;
  let requests = 0;
  globalThis.location = { href: 'https://example.test/game/' };
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: false, status: 404 };
  };
  try {
    const engine = new ArenaEngine(new EventTarget(), GAME_CONFIG);
    await assert.rejects(engine.load(), /engine is missing/i);
    await assert.rejects(engine.load(), /engine is missing/i);
    assert.equal(requests, 2);
    engine.dispose();
    await assert.rejects(engine.load(), /disposed/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});
