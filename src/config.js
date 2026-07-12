const deploymentBase = import.meta.env?.BASE_URL || '/';

export const GAME_CONFIG = Object.freeze({
  baseGame: 'baseoa',
  volume: 0.8,
  sensitivity: 5,
  engineUrl: `${deploymentBase}engine/ioquake3.js`,
  engineRevision: 'a66ff002-webmouse-5',
  configUrl: `${deploymentBase}engine/ioquake3-config.json`,
  dataBaseUrl: deploymentBase,
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
