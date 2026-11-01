export const LIMITS = {
  textMax: 24,
  maxNoteAgeMs: 25 * 3600_000,
  maxClockSkewMs: 120_000,
  maxLive: 100,
  maxRecords: 300,
  perAuthor: 20,
  maxPeers: 8,
  coordMm: 1500,
  presenceHz: 15,
  presenceMaxAgeMs: 30_000,
  heartbeatMs: 2000,
  peerTtlMs: 8000,
  noteBucket: { burst: 5, refillMs: 1000 },
  inboundPerSec: 2000,
  snapshotMinGapMs: 2000,
  cacheTtlMs: 86_400_000,
} as const;

export const RELAYS: readonly string[] = [
  'wss://cdn.satellite.earth',
  'wss://nos.lol',
  'wss://0x-nostr-relay.fly.dev',
  'wss://nostr.red5d.dev',
  'wss://bendernostur.duckdns.org:8443',
];

export const APP_ID = 'ar-surgical-planning';

export const PRESETS = ['Look here', 'Incision?', 'Fracture?', 'Avoid', 'Question'] as const;

export const asset = (p: string): string => import.meta.env.BASE_URL + p;
