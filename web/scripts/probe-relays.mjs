import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_ALIVE = 3;
const TIMEOUT_MS = 5000;

const config = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'config.ts'), 'utf8');
const block = /RELAYS[^=]*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? '';
const relays = [...block.matchAll(/'(wss:\/\/[^']+)'/g)].map((m) => m[1]);
if (relays.length === 0) {
  console.error('Could not read RELAYS from src/config.ts');
  process.exit(2);
}

function probe(url) {
  return new Promise((resolve) => {
    const started = Date.now();
    let ws;
    const done = (ok, note) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve({ url, ok, note, ms: Date.now() - started });
    };
    const timer = setTimeout(() => done(false, 'timeout'), TIMEOUT_MS);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return done(false, String(e.message));
    }
    ws.onerror = () => done(false, 'error');
    ws.onclose = () => done(false, 'closed');
    ws.onopen = () => ws.send(JSON.stringify(['REQ', randomBytes(4).toString('hex'), { kinds: [29333], limit: 1, '#x': [randomBytes(8).toString('hex')] }]));
    ws.onmessage = (m) => {
      const [kind] = JSON.parse(String(m.data));
      if (kind === 'EOSE' || kind === 'EVENT') done(true, kind);
      else if (kind === 'CLOSED' || kind === 'NOTICE') done(false, kind);
    };
  });
}

const results = await Promise.all(relays.map(probe));
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.url} ${r.note} ${r.ms} ms`);
const alive = results.filter((r) => r.ok).length;
console.log(`${alive} of ${relays.length} relays answered`);
process.exit(alive >= MIN_ALIVE ? 0 : 1);
