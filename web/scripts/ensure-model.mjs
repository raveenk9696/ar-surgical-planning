import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packModel } from './pack-model.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');

if (!existsSync(join(outDir, 'abdomen.glb'))) {
  const raw = process.env.AR_MODEL_SRC ?? '/tmp/ar-web-models/abdomen.glb';
  if (existsSync(raw)) {
    packModel(raw, outDir);
  } else {
    console.log('No model. Run the pipeline (see .github/workflows/pages.yml) and set AR_MODEL_SRC=<raw.glb>.');
  }
}
