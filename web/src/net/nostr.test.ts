import { expect, it, vi } from 'vitest';
import { joinRoom } from '@trystero-p2p/nostr';
import { createNostrTransport } from './nostr';

vi.mock('@trystero-p2p/nostr', () => ({
  joinRoom: vi.fn(() => ({ makeAction: () => ({ send: async () => undefined }), leave: async () => undefined })),
  getRelaySockets: () => ({}),
}));

it('caps receive buffers at 512 KiB before Trystero parses a message', async () => {
  const transport = await createNostrTransport('ABCDEFGHIJKLMNOPQRST');
  transport.open();
  transport.close();
  expect(joinRoom).toHaveBeenCalledWith(expect.objectContaining({ maxReceiveBytes: 512 * 1024 }), 'ABCDEFGHIJ', expect.any(Object));
});
