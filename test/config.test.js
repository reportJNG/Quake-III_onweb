import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_CONFIG, startupArguments } from '../src/config.js';

test('uses deployment-relative engine and data paths without dead match configuration', () => {
  assert.equal(GAME_CONFIG.engineUrl, '/engine/ioquake3.js');
  assert.equal(GAME_CONFIG.configUrl, '/engine/ioquake3-config.json');
  assert.equal(GAME_CONFIG.dataBaseUrl, '/');
  for (const unused of ['map', 'bots', 'botSkill', 'gameType', 'fragLimit', 'timeLimit']) {
    assert.equal(Object.hasOwn(GAME_CONFIG, unused), false);
  }
});

test('builds stable native startup arguments', () => {
  const args = startupArguments({ ...GAME_CONFIG, volume: 0.25, sensitivity: 7 });
  const pairs = new Map(Array.from({ length: args.length / 3 }, (_, index) => [args[index * 3 + 1], args[index * 3 + 2]]));
  assert.equal(pairs.get('com_basegame'), 'baseoa');
  assert.equal(pairs.get('r_fullscreen'), '0');
  assert.equal(pairs.get('net_enabled'), '0');
  assert.equal(pairs.get('s_volume'), '0.25');
  assert.equal(pairs.get('sensitivity'), '7');
});
