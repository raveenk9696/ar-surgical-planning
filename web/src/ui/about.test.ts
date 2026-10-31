import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('states author-only deletion and browser signatures without changing the rebuild and privacy disclosures', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toContain('Anyone with the link can see and add notes. You can delete your own.');
  expect(html).toContain('Notes are signed by the browser that wrote them.');
  for (const text of ['This page rebuilds the idea from scratch in 2026.', 'That app is not in this repository.', 'this browser keeps them 24 hours.', 'public Nostr relays carry encrypted connection data', 'Please do not type patient data.', 'doi:10.1117/12.2612993', 'doi:10.7937/TCIA.BBAG-2923']) expect(html).toContain(text);
});
