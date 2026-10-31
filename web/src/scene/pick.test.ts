import { BoxGeometry, Box3, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { lpsToRig, patientMatrix } from './coords';
import type { ModelHandle } from './model';
import { normalAt, pick } from './pick';

const CENTRE: Vec3 = [10, -20, -300];

function scene(): { model: ModelHandle; stage: Group; rig: Group; patient: Group } {
  const box = (size: number): Mesh => {
    const geometry = new BoxGeometry(size, size, size).translate(...CENTRE);
    geometry.boundsTree = new MeshBVH(geometry);
    return new Mesh(geometry, new MeshBasicMaterial());
  };
  const bone = box(100);
  const skin = box(160);
  const root = new Group().add(bone, skin);
  const patient = new Group();
  patient.matrixAutoUpdate = false;
  patient.matrix.copy(patientMatrix);
  patient.add(root);
  const rig = new Group().add(patient);
  rig.position.copy(lpsToRig(CENTRE, new Vector3())).negate();
  const stage = new Group().add(rig);
  stage.position.set(0.3, 1, -0.5);
  stage.rotation.y = 0.7;
  stage.scale.setScalar(0.5);
  stage.updateMatrixWorld(true);
  const model = {
    root,
    bone,
    skin,
    bbox: new Box3(),
    centre: CENTRE,
    heightM: 0.16,
    widthM: 0.16,
    mounted: { rig, patient },
    setMaterials: () => undefined,
    dispose: () => undefined,
  } satisfies ModelHandle;
  return { model, stage, rig, patient };
}

/** A ray in world space that looks at the LPS point `target` from `side` mm outside along an LPS axis. */
function rayAt(patient: Group, target: Vec3, axis: Vec3): Raycaster {
  const from = new Vector3(...target).addScaledVector(new Vector3(...axis), 400).applyMatrix4(patient.matrixWorld);
  const to = new Vector3(...target).applyMatrix4(patient.matrixWorld);
  return new Raycaster(from, to.sub(from).normalize());
}

describe('pick', () => {
  it('returns the hit as LPS mm within 0.5 mm, whatever the stage pose', () => {
    const { model, patient } = scene();
    const target: Vec3 = [CENTRE[0] + 12.34, CENTRE[1] - 20.5, CENTRE[2] + 50];
    const hit = pick(model, rayAt(patient, target, [0, 0, 1]), true);
    expect(hit?.mesh).toBe('bone');
    expect(hit?.pos[0]).toBeCloseTo(target[0], 0);
    expect(hit?.pos[1]).toBeCloseTo(target[1], 0);
    expect(hit?.pos[2]).toBeCloseTo(target[2], 0);
    expect(Math.hypot(...(hit?.pos.map((c, i) => c - (target[i] ?? 0)) ?? [9, 9, 9]))).toBeLessThan(0.5);
  });

  it('reports the outward surface normal in LPS', () => {
    const { model, patient } = scene();
    const head = pick(model, rayAt(patient, [CENTRE[0], CENTRE[1], CENTRE[2] + 50], [0, 0, 1]), true);
    expect(head?.nrm).toEqual([0, 0, 1]);
    const left = pick(model, rayAt(patient, [CENTRE[0] + 50, CENTRE[1], CENTRE[2]], [1, 0, 0]), true);
    expect(left?.nrm).toEqual([1, 0, 0]);
  });

  it('prefers bone behind the skin, and hits skin only while it is visible', () => {
    const { model, patient } = scene();
    const target: Vec3 = [CENTRE[0] + 80, CENTRE[1] + 70, CENTRE[2]];
    const ray = (): Raycaster => rayAt(patient, target, [1, 0, 0]);
    expect(pick(model, ray(), true)?.mesh).toBe('skin');
    expect(pick(model, ray(), false)).toBeNull();
    const through: Vec3 = [CENTRE[0] + 80, CENTRE[1], CENTRE[2]];
    expect(pick(model, rayAt(patient, through, [1, 0, 0]), true)?.mesh).toBe('bone');
  });

  it('misses and handles an unmounted model', () => {
    const { model, patient } = scene();
    expect(pick(model, rayAt(patient, [CENTRE[0] + 500, 0, 0], [0, 0, 1]), true)).toBeNull();
    expect(pick({ ...model, mounted: null }, rayAt(patient, CENTRE, [0, 0, 1]), true)).toBeNull();
  });

  it('puts a pin back on the surface it came from', () => {
    const { model, stage, rig, patient } = scene();
    const hit = pick(model, rayAt(patient, [CENTRE[0] + 5, CENTRE[1] + 5, CENTRE[2] + 50], [0, 0, 1]), true);
    if (!hit) throw new Error('no hit');
    const pin = lpsToRig(hit.pos, new Vector3()).applyMatrix4(rig.matrixWorld);
    const onSurface = new Vector3(...hit.pos).applyMatrix4(patient.matrixWorld);
    expect(pin.distanceTo(onSurface) * 1000 / stage.scale.x).toBeLessThan(0.5);
  });

  it('finds the normal under a remote pointer', () => {
    const { model } = scene();
    expect(normalAt(model, [CENTRE[0], CENTRE[1], CENTRE[2] + 50])).toEqual([0, 0, 1]);
    expect(normalAt(model, [CENTRE[0] - 50, CENTRE[1], CENTRE[2]])).toEqual([-1, 0, 0]);
  });
});

