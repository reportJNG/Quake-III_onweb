const deploymentBase = import.meta.env?.BASE_URL || '/';

export const GAME_CONFIG = Object.freeze({
  baseGame: 'baseoa',
  volume: 0.8,
  sensitivity: 5,
  maps: Object.freeze(['aggressor', 'oa_dm1', 'oa_dm5', 'sleekgrinder', 'wrackdm17']),
  playerModels: Object.freeze(['assassin', 'major', 'penguin', 'skelebot', 'smarine']),
  botNames: Object.freeze(['Assassin', 'Major', 'Penguin', 'Skelebot', 'Grunt']),
  botSkill: 5,
  playerCount: 6,
  fragLimit: 20,
  timeLimit: 8,
  engineUrl: `${deploymentBase}engine/ioquake3.js`,
  engineRevision: 'a66ff002-webmouse-5',
  configUrl: `${deploymentBase}engine/ioquake3-config.json`,
  dataBaseUrl: deploymentBase,
  filesystemVersion: 2,
});

export function createArenaSession(config = GAME_CONFIG, random = Math.random) {
  const maps = [...config.maps];
  for (let index = maps.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.max(0, Math.min(0.999999, random())) * (index + 1));
    [maps[index], maps[swap]] = [maps[swap], maps[index]];
  }
  const modelIndex = Math.floor(Math.max(0, Math.min(0.999999, random())) * config.playerModels.length);
  return Object.freeze({
    maps: Object.freeze(maps),
    playerModel: config.playerModels[modelIndex],
    botNames: config.botNames,
  });
}

export function startupArguments(
  config = GAME_CONFIG,
  session = createArenaSession(config),
  display = { width: 1280, height: 720 },
) {
  const firstMapIndex = config.maps.indexOf(session.maps[0]);
  const nextMapNumber = (firstMapIndex + 1) % config.maps.length + 1;
  const args = [
    '+set', 'sv_pure', '0',
    '+set', 'net_enabled', '0',
    '+set', 'r_mode', '-1',
    '+set', 'r_customwidth', String(display.width),
    '+set', 'r_customheight', String(display.height),
    '+set', 'r_fullscreen', '0',
    '+set', 'r_centerWindow', '1',
    '+set', 'in_mouse', '1',
    '+set', 'in_nograb', '0',
    '+set', 'com_basegame', config.baseGame,
    '+set', 'com_homepath', 'openarena-web',
    '+set', 'com_gamename', 'openarena',
    '+set', 's_volume', String(config.volume),
    '+set', 'sensitivity', String(config.sensitivity),
    '+set', 'name', 'WebRunner',
    '+set', 'sv_maxclients', String(config.playerCount),
    '+set', 'g_gametype', '0',
    '+set', 'g_spSkill', String(config.botSkill),
    '+set', 'bot_minplayers', String(config.playerCount),
    '+set', 'fraglimit', String(config.fragLimit),
    '+set', 'timelimit', String(config.timeLimit),
    '+set', 'g_doWarmup', '0',
    '+set', 'cl_run', '1',
    '+set', 'model', session.playerModel,
    '+set', 'activeAction', 'exec webarena-bots.cfg',
    '+exec', 'webarena-rotation.cfg',
  ];
  args.push('+set', 'nextmap', `vstr web_map_${nextMapNumber}`);
  args.push('+map', session.maps[0]);
  return args;
}
