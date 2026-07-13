import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import AdmZip from 'adm-zip';

const MAPS = ['aggressor', 'oa_dm1', 'oa_dm5', 'sleekgrinder', 'wrackdm17'];
const MODELS = ['assassin', 'major', 'penguin', 'skelebot', 'smarine'];
const ASSET_PREFIXES = ['env/', 'gfx/', 'icons/', 'levelshots/', 'maps/', 'menu/', 'models/', 'music/', 'sound/', 'sprites/', 'textures/', 'video/'];
const ASSET_EXTENSIONS = ['.tga', '.jpg', '.jpeg', '.png', '.wav', '.ogg', '.opus', '.md3', '.skin', '.cfg', '.shader', '.roq'];
const TEXT_EXTENSIONS = new Set(['.arena', '.bot', '.cfg', '.c', '.chat', '.jts', '.skin', '.txt']);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const root = resolve(import.meta.dirname, '..');
const cachedSource = resolve(root, '.cache/full-baseoa');
const defaultSource = await stat(resolve(cachedSource, 'pak0.pk3')).then(() => '.cache/full-baseoa').catch(() => 'public/baseoa');
const sourceDir = resolve(root, option('--source', defaultSource));
const outputPath = resolve(root, option('--output', 'public/baseoa/webarena.pk3'));
const outputBase = outputPath.replace(/\.pk3$/i, '');
const MAX_PART_BYTES = 80 * 1024 * 1024;

const normalize = (value) => value.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
const extension = (value) => value.includes('.') ? value.slice(value.lastIndexOf('.')).toLowerCase() : '';

function cleanText(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

function shaderDefinitions(text, path) {
  const tokens = cleanText(text).match(/"[^"]*"|[{}]|[^\s{}]+/g) || [];
  const definitions = [];
  let index = 0;
  while (index < tokens.length) {
    const name = tokens[index++].replace(/^"|"$/g, '');
    if (tokens[index] !== '{') continue;
    index += 1;
    let depth = 1;
    const body = [];
    while (index < tokens.length && depth > 0) {
      const token = tokens[index++];
      if (token === '{') depth += 1;
      else if (token === '}') depth -= 1;
      if (depth > 0) body.push(token.replace(/^"|"$/g, ''));
    }
    definitions.push({ name: normalize(name), path, body });
  }
  return definitions;
}

function pathReferences(text) {
  const pattern = /(?:env|gfx|icons|levelshots|maps|menu|models|music|sound|sprites|textures|video)[\\/][a-zA-Z0-9_.@+\-/]+/g;
  return (text.match(pattern) || []).map((match) => normalize(match.replace(/[),;]+$/, '')));
}

function bspReferences(data) {
  if (data.length < 144 || data.toString('ascii', 0, 4) !== 'IBSP') {
    throw new Error('Selected map is not a valid ioquake3 BSP.');
  }
  const references = [];
  const entityOffset = data.readInt32LE(8);
  const entityLength = data.readInt32LE(12);
  references.push(...pathReferences(data.toString('latin1', entityOffset, entityOffset + entityLength)));
  const shaderOffset = data.readInt32LE(16);
  const shaderLength = data.readInt32LE(20);
  for (let offset = shaderOffset; offset + 64 <= shaderOffset + shaderLength; offset += 72) {
    references.push(normalize(data.subarray(offset, offset + 64).toString('ascii').replace(/\0.*$/, '')));
  }
  return references;
}

function binaryReferences(data) {
  return pathReferences(data.toString('latin1'));
}

function customBots() {
  return `// Curated offline WebArena opponents.\n${[
    ['Assassin', 'assassin', 'bots/sergei_c.c'],
    ['Major', 'major', 'bots/major_c.c'],
    ['Penguin', 'penguin', 'bots/penguin_c.c'],
    ['Skelebot', 'skelebot', 'bots/skelebot_c.c'],
    ['Grunt', 'smarine', 'bots/grunt_c.c'],
    ['Sarge', 'sarge', 'bots/sarge_c.c'],
  ].map(([name, model, ai]) => `{\nname ${name}\nmodel ${model}\naifile ${ai}\n}`).join('\n')}\n`;
}

function customArenas() {
  const names = {
    aggressor: 'Aggressive Tendencies',
    oa_dm1: 'Think Twice Or Die',
    oa_dm5: 'Inner Cistern',
    sleekgrinder: 'Sleek Grinder',
    wrackdm17: 'Never Ending Yard',
  };
  return MAPS.map((map) => `{\nmap "${map}"\nlongname "${names[map]}"\ntype "ffa"\n}`).join('\n');
}

const pakNames = (await readdir(sourceDir))
  .filter((name) => /^pak.*\.pk3$/i.test(name) && name.toLowerCase() !== basename(outputPath).toLowerCase())
  .sort((left, right) => left.localeCompare(right, 'en'));
if (!pakNames.some((name) => name.toLowerCase() === 'pak0.pk3') || pakNames.length < 5) {
  throw new Error(`Full OpenArena PK3 files are required in ${sourceDir}. Run npm run prepare:assets first.`);
}

const archives = pakNames.map((name) => ({ name, zip: new AdmZip(resolve(sourceDir, name)) }));
const overlay = new Map();
for (const archive of archives) {
  for (const entry of archive.zip.getEntries()) {
    if (!entry.isDirectory) overlay.set(normalize(entry.entryName), { entry, archive: archive.name });
  }
}

const shaderIndex = new Map();
for (const [path, source] of overlay) {
  if (!path.endsWith('.shader')) continue;
  for (const definition of shaderDefinitions(source.entry.getData().toString('utf8'), path)) {
    shaderIndex.set(definition.name, definition);
  }
}

const included = new Map();
const queuedPaths = [];
const queuedReferences = [];
const usedShaders = new Set();

function enqueuePath(path) {
  const normalized = normalize(path);
  if (included.has(normalized) || queuedPaths.includes(normalized)) return;
  if (overlay.has(normalized)) queuedPaths.push(normalized);
}

function enqueuePrefix(prefix) {
  const normalized = normalize(prefix);
  for (const path of overlay.keys()) if (path.startsWith(normalized)) enqueuePath(path);
}

function enqueueReference(reference) {
  const normalized = normalize(reference).replace(/^"|"$/g, '');
  if (!normalized || normalized.startsWith('$') || normalized === '-') return;
  queuedReferences.push(normalized);
}

const baseArchive = archives.find((archive) => archive.name.toLowerCase() === 'pak0.pk3');
for (const entry of baseArchive.zip.getEntries()) if (!entry.isDirectory) enqueuePath(entry.entryName);
for (const map of MAPS) {
  for (const suffix of ['.bsp', '.aas']) enqueuePath(`maps/${map}${suffix}`);
  for (const suffix of ['.tga', '.jpg', '.png']) enqueuePath(`levelshots/${map}${suffix}`);
}
for (const model of MODELS) {
  enqueuePrefix(`models/players/${model}/`);
  enqueuePrefix(`sound/player/${model}/`);
}
enqueuePrefix('botfiles/');
enqueuePrefix('glsl/');
for (const prefix of [
  'sound/',
  'music/',
  'icons/',
  'sprites/',
  'gfx/2d/',
  'gfx/fx/',
  'models/ammo/',
  'models/items/',
  'models/powerups/',
  'models/weaphits/',
  'models/weapons/',
  'models/weapons2/',
  'textures/effects/',
  'textures/flares/',
  'textures/sfx/',
]) enqueuePrefix(prefix);

while (queuedPaths.length || queuedReferences.length) {
  while (queuedReferences.length) {
    const reference = queuedReferences.shift();
    if (overlay.has(reference)) enqueuePath(reference);
    if (!extension(reference)) {
      for (const suffix of ASSET_EXTENSIONS) enqueuePath(`${reference}${suffix}`);
      for (const path of overlay.keys()) {
        if (path.startsWith(`${reference}_`) && ASSET_EXTENSIONS.includes(extension(path))) enqueuePath(path);
      }
    }
    const shader = shaderIndex.get(reference);
    if (shader && !usedShaders.has(reference)) {
      usedShaders.add(reference);
      enqueuePath(shader.path);
      for (const token of shader.body) {
        if (ASSET_PREFIXES.some((prefix) => normalize(token).startsWith(prefix))) enqueueReference(token);
      }
    }
  }

  const path = queuedPaths.shift();
  if (!path || included.has(path)) continue;
  const source = overlay.get(path);
  if (!source) continue;
  const data = source.entry.getData();
  included.set(path, data);

  const ext = extension(path);
  let references = [];
  if (ext === '.bsp') references = bspReferences(data);
  else if (ext === '.md3') references = binaryReferences(data);
  else if (TEXT_EXTENSIONS.has(ext)) references = pathReferences(data.toString('latin1'));
  for (const reference of references) enqueueReference(reference);
}

included.set('scripts/bots.txt', Buffer.from(customBots()));
included.set('scripts/arenas.txt', Buffer.from(customArenas()));
included.set('webarena-bots.cfg', Buffer.from(`${MODELS.map((model) => {
  const bot = ({ assassin: 'Assassin', major: 'Major', penguin: 'Penguin', skelebot: 'Skelebot', smarine: 'Grunt' })[model];
  return `addbot ${bot} 5`;
}).join('\n')}\n`));
included.set('webarena-rotation.cfg', Buffer.from(`${MAPS.map((map, index) => {
  const next = (index + 1) % MAPS.length + 1;
  return `set web_map_${index + 1} "map ${map}; set nextmap vstr web_map_${next}"`;
}).join('\n')}\n`));

const outputDir = resolve(outputPath, '..');
await mkdir(outputDir, { recursive: true });
for (const name of await readdir(outputDir)) {
  const candidate = resolve(outputDir, name);
  if (candidate === outputPath || normalize(candidate).match(new RegExp(`${normalize(outputBase)}-\\d+\\.pk3$`))) {
    await unlink(candidate).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

const parts = [[]];
let partBytes = 0;
for (const item of [...included].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
  if (partBytes > 0 && partBytes + item[1].length > MAX_PART_BYTES) {
    parts.push([]);
    partBytes = 0;
  }
  parts.at(-1).push(item);
  partBytes += item[1].length;
}

let totalSize = 0;
for (let index = 0; index < parts.length; index += 1) {
  const partPath = `${outputBase}-${index + 1}.pk3`;
  const output = new AdmZip();
  for (const [path, data] of parts[index]) output.addFile(path, data);
  output.writeZip(partPath);
  const size = (await stat(partPath)).size;
  totalSize += size;
  console.log(`Built ${partPath}: ${(size / 1024 / 1024).toFixed(1)} MiB.`);
}
console.log(`Included ${included.size} files, ${usedShaders.size} referenced shaders, and ${MAPS.length} maps.`);
console.log(`Total slim download: ${(totalSize / 1024 / 1024).toFixed(1)} MiB across ${parts.length} PK3 files.`);
