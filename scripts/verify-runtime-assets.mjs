import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'public');
const engineDir = resolve(publicDir, 'engine');
const manifestPath = resolve(engineDir, 'ioquake3-config.json');

async function requireFile(path, expectedSize) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing runtime asset: ${path}`);
    throw error;
  }

  if (!details.isFile() || details.size === 0) {
    throw new Error(`Runtime asset is empty or invalid: ${path}`);
  }
  if (expectedSize > 0 && details.size !== expectedSize) {
    throw new Error(`Runtime asset size mismatch for ${path}: expected ${expectedSize}, received ${details.size}`);
  }
}

await Promise.all([
  requireFile(resolve(engineDir, 'ioquake3.js')),
  requireFile(resolve(engineDir, 'ioquake3.wasm')),
  requireFile(manifestPath),
]);

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch (error) {
  throw new Error(`Invalid engine manifest ${manifestPath}: ${error.message}`);
}

const files = manifest.baseoa?.files;
if (!Array.isArray(files) || files.length === 0) {
  throw new Error(`Engine manifest does not list any baseoa runtime assets: ${manifestPath}`);
}

await Promise.all(files.map((file) => {
  if (typeof file.src !== 'string' || !file.src.startsWith('baseoa/')) {
    throw new Error(`Invalid baseoa runtime asset path in ${manifestPath}: ${file.src}`);
  }
  return requireFile(resolve(publicDir, file.src), Number(file.size));
}));

console.log(`Verified the WebAssembly engine and ${files.length} OpenArena runtime assets.`);
