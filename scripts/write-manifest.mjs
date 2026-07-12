import { resolve } from 'node:path';
import { writeAssetManifest } from './manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'public/baseoa');
const output = resolve(root, 'public/engine/ioquake3-config.json');
const manifest = await writeAssetManifest(dir, output);
console.log(`Wrote manifest for ${manifest.baseoa.files.length} PK3 files.`);
