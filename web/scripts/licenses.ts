import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

function packageDirectory(id: string): string | null {
  const marker = '/node_modules/';
  const start = id.lastIndexOf(marker);
  if (start < 0) return null;
  const path = id.slice(start + marker.length);
  const name = /^(?:@[^/]+\/)?[^/]+/.exec(path)?.[0];
  return name ? id.slice(0, start + marker.length) + name : null;
}

function packageNotice(directory: string): string {
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string };
  const files = readdirSync(directory).filter((file) => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(file)).sort();
  if (!files.some((file) => /^(?:licen[cs]e|copying)(?:\..*)?$/i.test(file))) throw new Error(`Missing license for ${metadata.name}`);
  const notices = files.map((file) => readFileSync(join(directory, file), 'utf8').trim());
  return `== ${metadata.name}@${metadata.version} ==\n\n${notices.join('\n\n')}`;
}

// three ships third-party code under examples/jsm/libs with its own copyright header,
// which three's LICENSE does not cover.
function vendoredNotice(id: string): string | null {
  if (!id.includes('/examples/jsm/libs/')) return null;
  const header: string[] = [];
  for (const line of readFileSync(id, 'utf8').split('\n')) {
    if (!line.startsWith('//')) break;
    header.push(line.replace(/^\/\/\s?/, ''));
  }
  if (!header.some((line) => /copyright/i.test(line))) return null;
  return `== ${id.slice(id.lastIndexOf('/') + 1)} (bundled with three) ==\n\n${header.join('\n')}`;
}

export function licenses(): Plugin {
  let publicDir = '';
  return {
    name: 'asp-licenses',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle() {
      const directories = new Set<string>();
      const vendored = new Set<string>();
      for (const id of this.getModuleIds()) {
        const directory = packageDirectory(id);
        if (directory) directories.add(directory);
        const notice = vendoredNotice(id);
        if (notice) vendored.add(notice);
      }
      const notices = [...[...directories].sort().map(packageNotice), ...[...vendored].sort()];
      const source = `Third-party licenses\n\n${notices.join('\n\n')}\n`;
      writeFileSync(join(publicDir, 'LICENSES.txt'), source);
      this.emitFile({ type: 'asset', fileName: 'LICENSES.txt', source });
    },
  };
}
