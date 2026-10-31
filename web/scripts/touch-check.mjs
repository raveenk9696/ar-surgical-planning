import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const profile = await mkdtemp('/tmp/asp-touch-');
const chrome = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--use-angle=metal', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
], { stdio: 'ignore' });
let socket;
let exitError;
chrome.on('error', (error) => { exitError = error; });
async function until(probe, message) {
  for (let i = 0; i < 200; i++) {
    if (exitError) throw exitError;
    const value = await probe();
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}
try {
  const port = await until(async () => {
    try { return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch { return null; }
  }, 'Chrome did not start');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (call) {
      pending.delete(message.id);
      if (message.error) call.reject(new Error(JSON.stringify(message.error)));
      else call.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const tap = async ({ x, y }) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: `${process.env.TOUCH_URL ?? 'http://127.0.0.1:5185/'}?debug=1&transport=tabs&quality=lite` });
  await until(() => evaluate('!!window.__asp?.viewer?.model()'), 'The model did not load');
  await tap(await evaluate(`(() => { const r = document.getElementById('btn-add').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`));
  const point = await evaluate(`(async () => {
    const { pick } = await import('/src/scene/pick.ts');
    const viewer = window.__asp.viewer;
    viewer.stage.controls.autoRotate = false;
    for (let y = 310; y < 500; y += 10) for (let x = 160; x < 240; x += 10) {
      if (pick(viewer.model(), viewer.stage.rayAt(x, y), viewer.skinOn())) return { x, y };
    }
    return null;
  })()`);
  assert.ok(point, 'No tappable model point');
  await tap(point);
  await delay(150);
  const active = await evaluate('document.activeElement.id');
  for (const key of 'phone note') {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }
  const value = await evaluate("document.getElementById('note-input').value");
  console.log(JSON.stringify({ width: 390, height: 844, hasTouch: await evaluate('navigator.maxTouchPoints > 0'), activeElement: active, activeTag: await evaluate('document.activeElement.tagName'), value, errors }));
  assert.equal(active, 'note-input', 'The compatibility mouse events must not steal focus');
  assert.equal(value, 'phone note', 'Typed text must land in the note input');
  assert.deepEqual(errors, []);
} finally {
  socket?.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGTERM');
    await Promise.race([exited, delay(3000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await exited; }
  }
  await rm(profile, { recursive: true, force: true });
}
