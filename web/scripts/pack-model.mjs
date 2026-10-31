import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const gltfpack = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.bin', 'gltfpack');

// Quantized positions (-vp) would add node scale and translation, which breaks the identity-transform check in the app.
const COMMON = ['-cc', '-kn', '-vpf', '-vc', '8'];
const LITE_RATIO = '0.35';

export function packModel(raw, outDir) {
  mkdirSync(outDir, { recursive: true });
  const full = join(outDir, 'abdomen.glb');
  const lite = join(outDir, 'abdomen-lite.glb');
  execFileSync(gltfpack, ['-i', raw, '-o', full, ...COMMON], { stdio: 'inherit' });
  execFileSync(gltfpack, ['-i', raw, '-o', lite, ...COMMON, '-si', LITE_RATIO], { stdio: 'inherit' });
  return [full, lite];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [raw, outDir] = process.argv.slice(2);
  if (!raw || !outDir) {
    console.error('Usage: node scripts/pack-model.mjs <raw.glb> <outDir>');
    process.exit(2);
  }
  for (const f of packModel(resolve(raw), resolve(outDir))) console.log('wrote', f);
}
