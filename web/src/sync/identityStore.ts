import { LIMITS } from '../config';
import type { Peer } from '../types';
import { base64url, newPeer, type Identity } from './identity';

export interface StoredIdentity {
  peer: Peer;
  keys: CryptoKeyPair;
  expiresAt: number;
}
export interface IdentityStore {
  read(): Promise<StoredIdentity | undefined>;
  write(value: StoredIdentity): Promise<void>;
}

function browserStore(): IdentityStore {
  // Separate tabs need separate authors and counters; sessionStorage survives a reload.
  let slot = sessionStorage.getItem('asp:identity-slot');
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!slot || navigation?.type === 'navigate') {
    slot = crypto.randomUUID();
    sessionStorage.setItem('asp:identity-slot', slot);
  }
  const key = slot;
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('asp-identities', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('identities');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Identity database blocked'));
  });
  return {
    async read() {
      const db = await database;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('identities', 'readwrite');
        const store = transaction.objectStore('identities');
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          if ((entry.value as StoredIdentity).expiresAt <= Date.now()) entry.delete();
          entry.continue();
        };
        const request = store.get(key);
        transaction.oncomplete = () => resolve(request.result as StoredIdentity | undefined);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
    async write(value) {
      const db = await database;
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('identities', 'readwrite');
          transaction.objectStore('identities').put(value, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    },
  };
}

export async function loadIdentity(store?: IdentityStore, now = Date.now()): Promise<Identity> {
  try {
    const persistence = store ?? browserStore();
    const saved = await persistence.read();
    let value: StoredIdentity;
    if (saved && saved.expiresAt > now && saved.expiresAt <= now + LIMITS.cacheTtlMs && !saved.keys.privateKey.extractable) {
      value = saved;
    } else {
      const identity = await newPeer();
      const raw = Uint8Array.from(atob(identity.publicKey.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
      const publicKey = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      value = { peer: identity.peer, keys: { publicKey, privateKey: identity.privateKey }, expiresAt: now + LIMITS.cacheTtlMs };
    }
    await persistence.write({ ...value, expiresAt: now + LIMITS.cacheTtlMs });
    return { peer: value.peer, privateKey: value.keys.privateKey, publicKey: base64url(await crypto.subtle.exportKey('raw', value.keys.publicKey)) };
  } catch {
    return newPeer();
  }
}
