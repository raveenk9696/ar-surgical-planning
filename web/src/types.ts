export type PeerId = string;
export type NoteId = string;
/** GLB-local DICOM LPS mm: x patient-left, y posterior, z head. The only frame on the wire. */
export type Vec3 = readonly [x: number, y: number, z: number];
export type Mesh = 'bone' | 'skin';
export interface Peer { id: PeerId; name: string }
export interface PresenceProof { publicKey: string; signature: string }
export interface Deletion { id: NoteId; signature: string }
interface NoteRecord {
  publicKey: string;
  signature: string;
  deletion: Deletion | null;
  id: NoteId;
  author: Peer;
  created: number;
  contentHash: string;
}
export interface LiveNote extends NoteRecord {
  deleted: false;
  pos: Vec3;
  nrm: Vec3;
  mesh: Mesh;
  text: string;
}
export interface Tombstone extends NoteRecord {
  deleted: true;
  pos?: never;
  nrm?: never;
  mesh?: never;
  text?: never;
}
export type Note = LiveNote | Tombstone;
export interface Presence { peer: Peer; seq: number; sentAt?: number; ptr: Vec3 | null; away: boolean; /** local ms, never sent */ seenAt: number }
/** Record count and content digest. */
export interface Digest { n: number; h: number }
export type Wire =
  | { v: 2; k: 'hello'; from: Peer; digest: Digest }
  | { v: 2; k: 'snapshot'; from: PeerId; notes: Note[] }
  | { v: 2; k: 'note'; from: PeerId; note: Note }
  | { v: 2; k: 'presence'; from: Peer; seq: number; sentAt?: number; ptr: Vec3 | null; away: boolean; digest: Digest; proof?: PresenceProof }
  | { v: 2; k: 'bye'; from: PeerId };
export interface LinkStatus { tabs: 'ok' | 'off' | 'unavailable'; net: 'off' | 'connecting' | 'ok' | 'blocked' | 'down' }
export interface RoomState {
  roomId: string;
  self: Peer;
  notes: ReadonlyMap<NoteId, Note>;
  /** remote peers only */
  peers: ReadonlyMap<PeerId, Presence>;
  link: LinkStatus;
  netPeers: number;
}
export type AddResult = { ok: true; id: NoteId } | { ok: false; why: 'empty' | 'full' | 'rate' };
