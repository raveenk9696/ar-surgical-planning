import { Box3, BufferGeometry, Group, Mesh, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, CENTER, MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../types';
import type { Materials } from './materials';

export type ModelFailure = 'missing' | 'corrupt' | 'no-bone' | 'no-skin' | 'moved' | 'bad-size';

export class ModelError extends Error {
  constructor(readonly reason: ModelFailure, message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

export interface ModelHandle {
  readonly root: Group;
  readonly bone: Mesh;
  readonly skin: Mesh;
  /** LPS mm */
  readonly bbox: Box3;
  readonly centre: Vec3;
  /** Head-to-foot extent in metres */
  readonly heightM: number;
  readonly widthM: number;
  /** Set when the stage mounts the model: its rig and the patient group that holds `root`. */
  mounted: { rig: Object3D; patient: Object3D } | null;
  setMaterials(m: Materials): void;
  dispose(): void;
}

const MIN_MM = 100;
const MAX_MM = 1500;
const EPS = 1e-6;

const nextTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function fetchBuffer(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ModelError('missing', 'The 3D model could not be loaded. Check your connection and reload.');
  }
  // A dev server answers an unknown path with the page itself.
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) {
    throw new ModelError('missing', 'The 3D model file was not found.');
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress(Math.min(0.9, (got / total) * 0.9));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out.buffer;
}

function named(root: Object3D, name: 'bone' | 'skin'): Mesh {
  const o = root.getObjectByName(name);
  if (!o) throw new ModelError(name === 'bone' ? 'no-bone' : 'no-skin', `The 3D model has no ${name} part.`);
  if (!(o instanceof Mesh)) throw new ModelError(name === 'bone' ? 'no-bone' : 'no-skin', `The ${name} part of the 3D model is not a surface.`);
  return o;
}

/** A vertex used only by zero-area triangles gets a zero normal, which renders as a black speck. */
function fixDegenerateNormals(g: BufferGeometry): void {
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    if (n.getX(i) === 0 && n.getY(i) === 0 && n.getZ(i) === 0) n.setXYZ(i, 0, 0, 1);
  }
  n.needsUpdate = true;
}

function isIdentity(o: Object3D): boolean {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return o.matrixWorld.elements.every((v, i) => Math.abs(v - (id[i] ?? 0)) < EPS);
}

/** Loads the packed GLB, checks its contract, and builds the picking trees. Throws ModelError. */
export async function loadModel(url: string, onProgress: (f: number) => void): Promise<ModelHandle> {
  const buffer = await fetchBuffer(url, onProgress);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let root: Group;
  try {
    root = (await loader.parseAsync(buffer, '')).scene;
  } catch {
    throw new ModelError('corrupt', 'The 3D model file is damaged.');
  }
  root.updateMatrixWorld(true);
  const bone = named(root, 'bone');
  const skin = named(root, 'skin');
  if (!isIdentity(bone) || !isIdentity(skin)) throw new ModelError('moved', 'The 3D model is not in scan coordinates.');
  const bbox = new Box3().setFromObject(root);
  const size = bbox.getSize(new Vector3());
  for (const extent of [size.x, size.y, size.z]) {
    if (!(extent >= MIN_MM && extent <= MAX_MM)) throw new ModelError('bad-size', 'The 3D model has an unexpected size.');
  }

  for (const mesh of [bone, skin]) {
    const g: BufferGeometry = mesh.geometry;
    g.deleteAttribute('color');
    g.computeVertexNormals();
    fixDegenerateNormals(g);
  }
  for (const mesh of [bone, skin]) {
    mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, { strategy: CENTER });
    mesh.raycast = acceleratedRaycast;
    await nextTask();
  }
  onProgress(1);

  const centre = bbox.getCenter(new Vector3());
  return {
    root,
    bone,
    skin,
    bbox,
    centre: [centre.x, centre.y, centre.z],
    heightM: (bbox.max.z - bbox.min.z) / 1000,
    widthM: (bbox.max.x - bbox.min.x) / 1000,
    mounted: null,
    setMaterials(m) {
      bone.material = m.bone;
      skin.material = m.skin;
      bone.renderOrder = 1;
      skin.renderOrder = 2;
    },
    dispose() {
      for (const mesh of [bone, skin]) {
        mesh.geometry.boundsTree = undefined;
        mesh.geometry.dispose();
      }
    },
  };
}
