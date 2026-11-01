import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('ships license notices for every bundled package and both fonts', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'asp-licenses-'));
  try {
    const result = await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const outputs = Array.isArray(result) ? result : [result];
    const packages = new Set(['@fontsource-variable/inter', '@fontsource/homemade-apple']);
    for (const output of outputs) {
      if (!('output' in output)) throw new Error('Unexpected watcher');
      for (const chunk of output.output) {
        if (chunk.type !== 'chunk') continue;
        for (const id of Object.keys(chunk.modules)) {
          const name = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id)?.[1];
          if (name) packages.add(name);
        }
      }
    }
    expect([...packages]).toEqual(expect.arrayContaining(['three', 'three-mesh-bvh', '@trystero-p2p/nostr', '@trystero-p2p/core', '@noble/secp256k1']));
    const notices = readFileSync(join(outDir, 'LICENSES.txt'), 'utf8');
    for (const name of packages) {
      expect(notices).toContain(`== ${name}@`);
      expect(notices).toContain(readFileSync(join('node_modules', name, 'LICENSE'), 'utf8').trim());
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}, 20000);
