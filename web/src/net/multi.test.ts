import { describe, expect, it, vi } from 'vitest';
import { FakeHub } from '../test/fakehub';
import type { Wire } from '../types';
import { createMulti } from './multi';

const bye: Wire = { v: 1, k: 'bye', from: 'AAAAAAAA' };

describe('createMulti', () => {
  it('sends to every transport and merges what they receive and report', () => {
    const hub = new FakeHub();
    const a = hub.end('a');
    const b = hub.end('b');
    const multi = createMulti(a);
    multi.add(b);
    const raw = vi.fn();
    const status = vi.fn();
    multi.onMessage(raw);
    multi.onStatus(status);
    multi.open();
    multi.send(bye);
    expect(a.sent).toEqual([bye]);
    expect(b.sent).toEqual([bye]);
    a.inject(1);
    b.inject(2);
    expect(raw.mock.calls).toEqual([[1], [2]]);
    a.setStatus({ tabs: 'ok' });
    b.setStatus({ net: 'ok', peers: 1 });
    expect(status).toHaveBeenCalledWith({ net: 'ok', peers: 1 });
  });

  it('opens a transport added after open() and forwards its peer joins', () => {
    const hub = new FakeHub();
    const a = hub.end('a');
    const late = hub.end('late');
    const multi = createMulti(a);
    const joined = vi.fn();
    multi.onPeerJoin(joined);
    multi.open();
    const status = vi.fn();
    multi.onStatus(status);
    multi.add(late);
    expect(status).toHaveBeenCalledWith({ tabs: 'ok' });
    late.join();
    expect(joined).toHaveBeenCalledTimes(1);
  });

  it('stops delivering after close()', () => {
    vi.useFakeTimers();
    const hub = new FakeHub();
    const a = hub.end('a');
    const b = hub.end('b');
    const got = vi.fn();
    b.onMessage(got);
    const multi = createMulti(a);
    multi.open();
    b.open();
    multi.send(bye);
    vi.advanceTimersByTime(5);
    multi.close();
    multi.send(bye);
    vi.advanceTimersByTime(5);
    expect(got).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
