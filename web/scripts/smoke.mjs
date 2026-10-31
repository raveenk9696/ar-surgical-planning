import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const base = process.env.PAGES_BASE ?? '/ar-surgical-planning/';
const KB = 1024;
const MB = 1024 * KB;
const LIMITS = { entryGz: 260 * KB, lazyGz: 40 * KB, fullGlb: 2.5 * MB, liteGlb: 1 * MB, dist: 8 * MB, coordMm: 1500 };
// The pipeline output for the public abdomen scan, plus 5 mm of slack.
const FULL_BOX = { min: [-190, -120, -525], max: [170, 155, -45] };
const SLACK_MM = 5;

const failures = [];
const fail = (msg) => failures.push(msg);
const gz = (buf) => gzipSync(buf).length;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('No dist/index.html. Run npm run build first.');
  process.exit(2);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const files = walk(dist);

for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (/^(?:https?:|data:|#|mailto:)/.test(url)) continue;
  if (!url.startsWith(base)) fail(`index.html URL does not start with ${base}: ${url}`);
}
if (!html.includes('Content-Security-Policy')) fail('index.html has no Content-Security-Policy');

for (const f of files.filter((p) => ['.js', '.css', '.html'].includes(extname(p)))) {
  const text = readFileSync(f, 'utf8');
  for (const bad of ['"/models', "'/models", '"/fonts']) {
    if (text.includes(bad)) fail(`${f.slice(dist.length + 1)} has a root-absolute path ${bad}`);
  }
}

const entry = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
const entryFile = entry && join(dist, entry.slice(base.length));
const js = files.filter((p) => extname(p) === '.js');
if (!entryFile || !existsSync(entryFile)) fail('could not find the entry script in index.html');
else if (gz(readFileSync(entryFile)) > LIMITS.entryGz) fail(`entry JS is ${(gz(readFileSync(entryFile)) / KB).toFixed(1)} KB gzip, limit ${LIMITS.entryGz / KB} KB`);
const lazy = js.filter((p) => p !== entryFile);
if (lazy.length === 0) fail('no lazy chunk: the Nostr transport should load on its own');
for (const f of lazy) {
  if (gz(readFileSync(f)) > LIMITS.lazyGz) fail(`${f.slice(dist.length + 1)} is ${(gz(readFileSync(f)) / KB).toFixed(1)} KB gzip, limit ${LIMITS.lazyGz / KB} KB`);
}

const total = files.reduce((n, f) => n + statSync(f).size, 0);
if (total > LIMITS.dist) fail(`dist is ${(total / MB).toFixed(1)} MB, limit ${LIMITS.dist / MB} MB`);

function glbJson(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

function checkModel(path, limit, strictBox) {
  const name = path.slice(dist.length + 1);
  const size = statSync(path).size;
  if (size > limit) fail(`${name} is ${(size / MB).toFixed(2)} MB, limit ${(limit / MB).toFixed(1)} MB`);
  let g;
  try {
    g = glbJson(path);
  } catch (e) {
    return fail(`${name}: ${e.message}`);
  }
  const allowed = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression']);
  for (const ext of g.extensionsRequired ?? []) if (!allowed.has(ext)) fail(`${name} requires ${ext}`);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const part of ['bone', 'skin']) {
    const node = (g.nodes ?? []).find((n) => n.name === part);
    if (!node || node.mesh === undefined) {
      fail(`${name} has no mesh node "${part}"`);
      continue;
    }
    for (const key of ['matrix', 'translation', 'scale', 'rotation']) if (key in node) fail(`${name}: node "${part}" has ${key}`);
    for (const prim of g.meshes[node.mesh].primitives) {
      const acc = g.accessors[prim.attributes.POSITION];
      if (!acc?.min || !acc?.max) {
        fail(`${name}: "${part}" POSITION has no min and max`);
        continue;
      }
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], acc.min[i]);
        hi[i] = Math.max(hi[i], acc.max[i]);
      }
    }
  }
  for (let i = 0; i < 3; i++) {
    if (Math.abs(lo[i]) > LIMITS.coordMm || Math.abs(hi[i]) > LIMITS.coordMm) fail(`${name}: positions outside +-${LIMITS.coordMm} mm`);
    if (strictBox && (lo[i] < FULL_BOX.min[i] - SLACK_MM || hi[i] > FULL_BOX.max[i] + SLACK_MM)) {
      fail(`${name}: bounding box axis ${i} is ${lo[i].toFixed(0)}..${hi[i].toFixed(0)} mm, expected inside ${FULL_BOX.min[i]}..${FULL_BOX.max[i]}`);
    }
  }
  console.log(`${name}: ${(size / MB).toFixed(2)} MB, box ${lo.map((v) => v.toFixed(0)).join(',')} .. ${hi.map((v) => v.toFixed(0)).join(',')} mm`);
}

const modelsDir = join(dist, 'models');
const models = existsSync(modelsDir) ? readdirSync(modelsDir).filter((f) => f.endsWith('.glb')) : [];
if (models.length === 0) {
  if (process.env.SMOKE_REQUIRE_MODEL === '1') fail('no model in dist/models');
  else console.log('model checks skipped: no dist/models/*.glb');
} else {
  for (const m of models) checkModel(join(modelsDir, m), m.endsWith('-lite.glb') ? LIMITS.liteGlb : LIMITS.fullGlb, !m.endsWith('-lite.glb'));
  if (!models.includes('abdomen.glb') || !models.includes('abdomen-lite.glb')) fail('dist/models must hold abdomen.glb and abdomen-lite.glb');
}

if (entryFile) console.log(`entry ${(gz(readFileSync(entryFile)) / KB).toFixed(1)} KB gzip; lazy ${lazy.map((f) => `${(gz(readFileSync(f)) / KB).toFixed(1)} KB`).join(', ')}; dist ${(total / MB).toFixed(2)} MB`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}
console.log('smoke: ok');
