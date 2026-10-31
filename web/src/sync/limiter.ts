const PRUNE_ABOVE = 512;

export function createLimiter(o: { burst: number; refillMs: number }, now: () => number): { take(key: string): boolean } {
  const buckets = new Map<string, { tokens: number; at: number }>();

  const refilled = (b: { tokens: number; at: number }, t: number): number =>
    Math.min(o.burst, b.tokens + (t - b.at) / o.refillMs);

  return {
    take(key) {
      const t = now();
      const b = buckets.get(key) ?? { tokens: o.burst, at: t };
      const tokens = refilled(b, t);
      const ok = tokens >= 1;
      buckets.set(key, { tokens: ok ? tokens - 1 : tokens, at: t });
      if (buckets.size > PRUNE_ABOVE) {
        for (const [k, v] of buckets) if (refilled(v, t) >= o.burst) buckets.delete(k);
      }
      return ok;
    },
  };
}
