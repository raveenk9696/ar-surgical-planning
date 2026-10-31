import { Matrix4, Triangle, Vector3, type BufferGeometry, type Raycaster } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Mesh, Vec3 } from '../types';
import { rigDirToLps, rigToLps } from './coords';
import type { ModelHandle } from './model';

export interface Hit { pos: Vec3; nrm: Vec3; mesh: Mesh }

const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits + 0;

/** Bone first, then skin only while it is visible: a tap on a rib seen through glass pins the rib. */
export function pick(m: ModelHandle, ray: Raycaster, skinVisible: boolean): Hit | null {
  const at = m.mounted;
  if (!at) return null;
  ray.firstHitOnly = true;
  const boneHit = ray.intersectObject(m.bone, false)[0];
  const hit = boneHit ?? (skinVisible ? ray.intersectObject(m.skin, false)[0] : undefined);
  if (!hit?.face) return null;

  const world = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const rigNormal = world.transformDirection(new Matrix4().copy(at.rig.matrixWorld).invert());
  const pos = rigToLps(at.rig.worldToLocal(hit.point.clone()));
  const nrm = rigDirToLps(rigNormal);
  return {
    pos: [round(pos[0], 2), round(pos[1], 2), round(pos[2], 2)],
    nrm: [round(nrm[0], 3), round(nrm[1], 3), round(nrm[2], 3)],
    mesh: hit.object === m.bone ? 'bone' : 'skin',
  };
}

function faceNormal(g: BufferGeometry, face: number): Vector3 | null {
  const index = g.getIndex();
  const p = g.getAttribute('position');
  if (!index || !p) return null;
  const tri = new Triangle(
    new Vector3().fromBufferAttribute(p, index.getX(face * 3)),
    new Vector3().fromBufferAttribute(p, index.getX(face * 3 + 1)),
    new Vector3().fromBufferAttribute(p, index.getX(face * 3 + 2)),
  );
  return tri.getNormal(new Vector3());
}

/** Outward surface normal (LPS) at the point of the model closest to `pos`. Remote pointers carry no normal, so the viewer finds it. */
export function normalAt(m: ModelHandle, pos: Vec3): Vec3 | null {
  const at = new Vector3(...pos);
  let best: { d: number; n: Vector3 } | null = null;
  for (const mesh of [m.bone, m.skin]) {
    const bvh = mesh.geometry.boundsTree;
    const near = bvh instanceof MeshBVH ? bvh.closestPointToPoint(at) : null;
    const n = near ? faceNormal(mesh.geometry, near.faceIndex) : null;
    if (near && n && (!best || near.distance < best.d)) best = { d: near.distance, n };
  }
  return best ? [best.n.x, best.n.y, best.n.z] : null;
}
