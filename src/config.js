export const GAME_CONFIG = Object.freeze({
  baseGame: 'baseoa',
  map: 'oa_dm1',
  bots: ['Sarge', 'Major', 'Grunt'],
  botSkill: 3,
  gameType: 0,
  fragLimit: 20,
  timeLimit: 10,
  volume: 0.8,
  sensitivity: 5,
  engineUrl: '/engine/ioquake3.js',
  engineRevision: 'direct-mouse-bridge-4',
  configUrl: '/engine/ioquake3-config.json',
  dataBaseUrl: '/',
  filesystemVersion: 1,
});

export function startupArguments(config = GAME_CONFIG) {
  const args = [
    '+set', 'sv_pure', '0',
    '+set', 'net_enabled', '0',
    '+set', 'r_mode', '-2',
    '+set', 'r_fullscreen', '0',
    '+set', 'r_centerWindow', '1',
    '+set', 'in_mouse', '1',
    '+set', 'in_nograb', '0',
    '+set', 'com_basegame', config.baseGame,
    '+set', 'com_homepath', 'openarena-web',
    '+set', 'com_gamename', 'openarena',
    '+set', 's_volume', String(config.volume),
    '+set', 'sensitivity', String(config.sensitivity),
  ];
  return args;
}
