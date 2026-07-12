import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const OPENARENA_VERSION = '0.8.8';
export const OPENARENA_SHA1 = '37ab41990b37459822ce8c2fe590607616e1f6d1';

export async function createAssetManifest(directory) {
  const names = (await readdir(directory))
    .filter((name) => name.toLowerCase().endsWith('.pk3'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (!names.length) throw new Error(`No PK3 files found in ${directory}.`);
  const files = await Promise.all(names.map(async (name) => ({
    src: `baseoa/${name}`,
    dst: '/baseoa',
    size: (await stat(resolve(directory, name))).size,
  })));
  return {
    baseoa: {
      version: OPENARENA_VERSION,
      archiveSha1: OPENARENA_SHA1,
      files,
    },
  };
}

export async function writeAssetManifest(sourceDirectory, outputPath) {
  const manifest = await createAssetManifest(sourceDirectory);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
