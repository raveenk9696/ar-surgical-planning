import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'asp-model-test-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(new URL('../scripts/ensure-model.mjs', import.meta.url), join(root, 'scripts/ensure-model.mjs'));
  writeFileSync(join(root, 'scripts/pack-model.mjs'), `
    import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
    import { join } from 'node:path';
    export function packModel(raw, out) {
      mkdirSync(out, { recursive: true });
      for (const name of ['abdomen.glb', 'abdomen-lite.glb']) writeFileSync(join(out, name), readFileSync(raw));
    }
  `);
  const source = join(root, 'source.bin');
  const output = join(root, 'public/models/abdomen.glb');
  const run = (raw?: string) => {
    const env = { ...process.env };
    delete env.AR_MODEL_SRC;
    if (raw) env.AR_MODEL_SRC = raw;
    const result = spawnSync(process.execPath, [join(root, 'scripts/ensure-model.mjs')], { env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  return { source, output, run, close: () => rmSync(root, { recursive: true, force: true }) };
}

it('requires an explicit model source instead of reading a shared temporary default', () => {
  const f = fixture();
  try {
    expect(f.run()).toContain('set AR_MODEL_SRC=<raw.glb>');
    expect(existsSync(f.output)).toBe(false);
  } finally { f.close(); }
});

it('repacks changed source content even when size and timestamp stay unchanged', () => {
  const f = fixture();
  try {
    writeFileSync(f.source, 'first');
    const before = statSync(f.source);
    f.run(f.source);
    expect(readFileSync(f.output, 'utf8')).toBe('first');
    const packed = statSync(f.output).mtimeMs;
    f.run(f.source);
    expect(statSync(f.output).mtimeMs).toBe(packed);
    writeFileSync(f.source, 'other');
    utimesSync(f.source, before.atime, before.mtime);
    f.run(f.source);
    expect(readFileSync(f.output, 'utf8')).toBe('other');
  } finally { f.close(); }
});
