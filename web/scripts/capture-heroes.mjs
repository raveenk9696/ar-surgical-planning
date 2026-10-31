import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
const endpoint = process.env.CDP_URL ?? 'http://localhost:9237';
const origin = process.env.APP_URL ?? 'http://localhost:5181/';
const output = process.env.HERO_OUTPUT ?? '../docs';
function optimizePng(png) {
  const chunks = [], pixels = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), chunk = png.subarray(at, at + length + 12);
    if (chunk.toString('ascii', 4, 8) === 'IDAT') pixels.push(chunk.subarray(8, -4));
    else chunks.push(chunk);
    at += length + 12;
  }
  const compressed = deflateSync(inflateSync(Buffer.concat(pixels)), { level: 9 });
  const data = Buffer.concat([Buffer.from('IDAT'), compressed]);
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(compressed.length); checksum.writeUInt32BE(crc32(data));
  chunks.splice(chunks.length - 1, 0, Buffer.concat([size, data, checksum]));
  const optimized = Buffer.concat([png.subarray(0, 8), ...chunks]);
  return optimized.length < png.length ? optimized : png;
}
const checkOnly = process.argv.includes('--check-layout');
const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data), call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  if (message.error) call.reject(new Error(JSON.stringify(message.error)));
  else call.resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const until = async (expression) => {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
};
try {
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const mode of checkOnly ? ['desktop', 'together'] : ['model', 'together']) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 810, deviceScaleFactor: 5 / 3, mobile: false });
    const url = new URL(origin);
    url.search = `debug=1&transport=tabs${mode === 'desktop' ? '' : `&hero=${mode}`}`;
    await send('Page.navigate', { url: url.href });
    await until('!!window.__asp?.viewer && performance.getEntriesByName("asp:first-frame").length > 0');
    await evaluate('document.fonts.ready');
    if (mode !== 'desktop') await until(`document.body.classList.contains('hero-${mode}') && window.__asp.state().notes.size === 1`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const result = await evaluate(`(() => {
      const { viewer } = window.__asp, { renderer, patient, camera } = viewer.stage;
      const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const title = document.querySelector('.title-block').getBoundingClientRect();
      const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      patient.traverse(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        const pos = mesh.geometry.attributes.position, point = camera.position.clone();
        for (let i = 0; i < pos.count; i++) {
          point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(camera);
          const x = (point.x + 1) * innerWidth / 2, y = (1 - point.y) * innerHeight / 2;
          bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
          bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        }
      });
      return { gpu, title: title.toJSON(), bounds, notes: [...window.__asp.state().notes.values()], skin: viewer.skinOn(), people: document.querySelector('#rail').textContent };
    })()`);
    console.log(mode, JSON.stringify(result));
    assert.match(result.gpu, /Apple|Metal/);
    assert.doesNotMatch(result.gpu, /SwiftShader|llvmpipe/);
    if (mode === 'desktop') assert.ok(result.bounds.top > result.title.bottom + 12, 'desktop title overlaps anatomy');
    if (mode === 'together') {
      assert.equal(result.title.height, 0, 'together hero must hide the title');
      assert.equal(result.skin, false);
      assert.match(result.people, /Guest 2/);
      assert.equal(result.notes.length, 1);
      assert.equal(result.notes[0].text, 'look here');
      assert.ok(result.notes[0].pos[0] < 0, 'right iliac wing is patient-right');
    }
    if (mode === 'model') {
      assert.equal(result.skin, true);
      assert.equal(result.notes[0].text, 'left hip');
      assert.ok(result.notes[0].pos[0] > 0, 'left hip is patient-left');
    }
    if (!checkOnly) {
      await mkdir(output, { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const png = optimizePng(Buffer.from(shot.data, 'base64'));
      assert.equal(png.readUInt32BE(16), 2400);
      assert.equal(png.readUInt32BE(20), 1350);
      assert.ok(png.length < 1_500_000, 'hero PNG exceeds 1.5 MB');
      await writeFile(`${output}/hero-${mode}.png`, png);
      console.log(`hero-${mode}.png: 2400x1350, ${png.length} bytes`);
    }
  }
} finally {
  await fetch(`${endpoint}/json/close/${target.id}`);
  socket.close();
}
