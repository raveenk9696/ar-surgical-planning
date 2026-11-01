import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packModel } from './pack-model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');
const raw = process.env.AR_MODEL_SRC;
const packed = ['abdomen.glb', 'abdomen-lite.glb'].every((name) => existsSync(join(outDir, name)));

if (raw && existsSync(raw)) {
  const hash = createHash('sha256').update(readFileSync(raw)).digest('hex');
  const stamp = join(outDir, '.source.sha256');
  const previous = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
  if (!packed || hash !== previous) {
    packModel(raw, outDir);
    writeFileSync(stamp, hash);
  }
} else if (!packed || raw) {
  console.error('No model. Run the pipeline (see .github/workflows/pages.yml) and set AR_MODEL_SRC=<raw.glb>.');
  process.exit(1);
}
