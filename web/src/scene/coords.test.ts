import fc from 'fast-check';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { lpsDirToRig, lpsToRig, patientMatrix, placeInFront, rigDirToLps, rigToLps, yawToward } from './coords';

const world = (v: Vec3): Vector3 => new Vector3(...v).applyMatrix4(patientMatrix);

describe('patient frame', () => {
  it('puts the head up, patient-left on +X and the front on +Z', () => {
    const head = world([0, 0, 100]);
    const left = world([100, 0, 0]);
    const front = world([0, -100, 0]);
    expect([head.x, head.y, head.z].map((c) => Math.round(c * 1e6) / 1e6)).toEqual([0, 0.1, 0]);
    expect(left.x).toBeCloseTo(0.1);
    expect(front.z).toBeCloseTo(0.1);
  });

  it('does not mirror the patient', () => {
    expect(patientMatrix.determinant()).toBeGreaterThan(0);
  });

  it('maps a point the same way as lpsToRig', () => {
    fc.assert(
      fc.property(fc.tuple(fc.double({ min: -500, max: 500, noNaN: true }), fc.double({ min: -500, max: 500, noNaN: true }), fc.double({ min: -500, max: 500, noNaN: true })), (v) => {
        const a = world(v);
        const b = lpsToRig(v, new Vector3());
        expect(a.distanceTo(b)).toBeLessThan(1e-9);
      }),
    );
  });

  it('round trips LPS through the rig within 1e-6 mm', () => {
    fc.assert(
      fc.property(fc.tuple(fc.double({ min: -1500, max: 1500, noNaN: true }), fc.double({ min: -1500, max: 1500, noNaN: true }), fc.double({ min: -1500, max: 1500, noNaN: true })), (v) => {
        const back = rigToLps(lpsToRig(v, new Vector3()));
        for (let i = 0; i < 3; i++) expect(Math.abs((back[i] ?? 0) - (v[i] ?? 0))).toBeLessThan(1e-6);
      }),
    );
  });

  it('maps directions without scaling them', () => {
    const d = lpsDirToRig([0.6, 0, 0.8]);
    expect(d.length()).toBeCloseTo(1);
    expect(rigDirToLps(d)).toEqual([0.6, 0, 0.8]);
  });
});

describe('placeInFront', () => {
  it('places the model 1.2 m ahead, 0.5 m below the eyes, front toward the viewer', () => {
    const rot = new Matrix4().makeRotationY(Math.PI / 2);
    const pose = new Matrix4().copy(rot).setPosition(1, 1.6, 2);
    const at = placeInFront(pose, 1.2);
    const p = new Vector3().setFromMatrixPosition(at);
    expect(p.y).toBeCloseTo(1.1);
    expect(Math.hypot(p.x - 1, p.z - 2)).toBeCloseTo(1.2);
    // the viewer looks along -X after a quarter turn
    expect(p.x).toBeCloseTo(1 - 1.2);
    const front = new Vector3(0, 0, 1).transformDirection(at);
    const toViewer = new Vector3(1, 0, 2).sub(new Vector3(p.x, 0, p.z)).normalize();
    expect(front.dot(toViewer)).toBeCloseTo(1);
  });

  it('keeps a stable heading when the viewer looks straight down', () => {
    const down = new Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, 1.5, 0);
    const p = new Vector3().setFromMatrixPosition(placeInFront(down, 1.2));
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  });

  it('turns a model at the origin toward a viewer', () => {
    expect(yawToward(new Vector3(0, 0, 0), new Vector3(0, 0, 3))).toBeCloseTo(0);
    expect(yawToward(new Vector3(0, 0, 0), new Vector3(3, 0, 0))).toBeCloseTo(Math.PI / 2);
  });
});
