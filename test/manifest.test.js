import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssetManifest, OPENARENA_SHA1 } from '../scripts/manifest.mjs';

test('creates a deterministic manifest with optional runtime size metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openarena-manifest-'));
  try {
    await writeFile(join(directory, 'z.pk3'), Buffer.alloc(7));
    await writeFile(join(directory, 'A.pk3'), Buffer.alloc(3));
    await writeFile(join(directory, 'ignored.txt'), 'not game data');
    const manifest = await createAssetManifest(directory);
    assert.equal(manifest.baseoa.archiveSha1, OPENARENA_SHA1);
    assert.deepEqual(manifest.baseoa.files, [
      { src: 'baseoa/A.pk3', dst: '/baseoa', size: 3 },
      { src: 'baseoa/z.pk3', dst: '/baseoa', size: 7 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
