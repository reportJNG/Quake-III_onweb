import assert from 'node:assert/strict';
import test from 'node:test';
import { createArenaSession, GAME_CONFIG, startupArguments } from '../src/config.js';

test('uses deployment-relative engine and focused arena configuration', () => {
  assert.equal(GAME_CONFIG.engineUrl, '/engine/ioquake3.js');
  assert.equal(GAME_CONFIG.configUrl, '/engine/ioquake3-config.json');
  assert.equal(GAME_CONFIG.dataBaseUrl, '/');
  assert.deepEqual(GAME_CONFIG.maps, ['aggressor', 'oa_dm1', 'oa_dm5', 'sleekgrinder', 'wrackdm17']);
  assert.equal(GAME_CONFIG.botSkill, 5);
  assert.equal(GAME_CONFIG.playerCount, 6);
});

test('randomizes maps and player models without losing any map', () => {
  const values = [0, 0, 0, 0, 0.8];
  const session = createArenaSession(GAME_CONFIG, () => values.shift());
  assert.deepEqual([...session.maps].sort(), [...GAME_CONFIG.maps].sort());
  assert.equal(session.playerModel, 'smarine');
  assert.deepEqual(session.botNames, GAME_CONFIG.botNames);
});

test('builds an offline hard-bot match and rotation', () => {
  const session = {
    maps: ['oa_dm1', 'oa_dm5', 'aggressor', 'sleekgrinder', 'wrackdm17'],
    playerModel: 'major',
    botNames: ['Assassin', 'Major', 'Penguin', 'Skelebot', 'Grunt'],
  };
  const args = startupArguments({ ...GAME_CONFIG, volume: 0.25, sensitivity: 7 }, session, { width: 1600, height: 900 });
  const pairs = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '+set') pairs.set(args[index + 1], args[index + 2]);
  }
  assert.equal(pairs.get('com_basegame'), 'baseoa');
  assert.equal(pairs.get('r_fullscreen'), '0');
  assert.equal(pairs.get('r_mode'), '-1');
  assert.equal(pairs.get('r_customwidth'), '1600');
  assert.equal(pairs.get('r_customheight'), '900');
  assert.equal(pairs.get('net_enabled'), '0');
  assert.equal(pairs.get('s_volume'), '0.25');
  assert.equal(pairs.get('sensitivity'), '7');
  assert.equal(pairs.get('g_spSkill'), '5');
  assert.equal(pairs.get('bot_minplayers'), '6');
  assert.equal(pairs.get('model'), 'major');
  assert.equal(pairs.get('activeAction'), 'exec webarena-bots.cfg');
  assert.equal(pairs.get('nextmap'), 'vstr web_map_3');
  assert.ok(args.includes('webarena-rotation.cfg'));
  const mapIndex = args.indexOf('+map');
  assert.equal(args[mapIndex + 1], 'oa_dm1');
  assert.equal(args.filter((argument) => argument === '+addbot').length, 0);
});
