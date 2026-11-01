import { MESSAGES } from './status';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('states author-only deletion and tab signatures without changing the rebuild and privacy disclosures', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toContain('the other people in the room can see your IP address');
  expect(html).toContain('browsers connect directly');
  expect(html).toContain('Anyone with the link can see and add notes.');
  expect(html).toContain('Notes are signed by this tab. You can delete your own notes while this tab stays open, for up to 24 hours.');
  for (const text of ['This page rebuilds the idea from scratch in 2026.', 'That app is not in this repository.', 'this browser keeps them 24 hours.', 'public Nostr relays carry encrypted connection data', 'Please do not type patient data.', 'doi:10.1117/12.2612993', 'doi:10.7937/TCIA.BBAG-2923']) expect(html).toContain(text);
});

it('describes the pelvis skin crop and room expiry accurately', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  expect(html).toContain('skin removed from the pelvis down');
});

it('explains author-only deletion when the room is full', () => {
  expect(MESSAGES.roomFull).toBe('This room has 100 notes. Notes expire after 24 hours, and only their authors can delete them.');
});
