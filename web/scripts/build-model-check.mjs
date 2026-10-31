import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync('/tmp/asp-model-build-');
const source = process.env.AR_MODEL_SRC ?? '/tmp/ar-web-models/abdomen.glb';
assert.ok(existsSync(source), 'Set AR_MODEL_SRC to the raw model');
const folders = ['public/models', 'dist/models'];
const checks = [];
try {
  for (const [i, folder] of folders.entries()) if (existsSync(join(root, folder))) renameSync(join(root, folder), join(temp, String(i)));
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, env: { ...process.env, AR_MODEL_SRC: source }, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  for (const name of ['abdomen.glb', 'abdomen-lite.glb']) checks.push({ check: `build packs ${name}`, ok: existsSync(join(root, 'dist/models', name)) });
  rmSync(join(root, 'dist/models'), { recursive: true, force: true });
  const smoke = spawnSync('npm', ['run', 'smoke'], { cwd: root, env: { ...process.env, AR_MODEL_SRC: source, SMOKE_REQUIRE_MODEL: '' }, encoding: 'utf8' });
  checks.push({ check: 'smoke rejects missing model when AR_MODEL_SRC is set', ok: smoke.status === 1 && smoke.stderr.includes('no model in dist/models'), exit: smoke.status });
  console.log(JSON.stringify(checks));
  assert.ok(checks.every((check) => check.ok), 'Build must pack both models and smoke must require them');
} finally {
  for (const [i, folder] of folders.entries()) {
    rmSync(join(root, folder), { recursive: true, force: true });
    if (existsSync(join(temp, String(i)))) renameSync(join(temp, String(i)), join(root, folder));
  }
  rmSync(temp, { recursive: true, force: true });
}
