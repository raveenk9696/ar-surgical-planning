import fc from 'fast-check';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../types';
import { fitDistance, homePosition, lpsDirToRig, lpsToRig, patientMatrix, placeInFront, rigDirToLps, rigToLps, yawToward } from './coords';

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

describe('camera framing', () => {
  it('fills 70% of the height on the desktop canvas: about 1.35 m for the abdomen', () => {
    const d = fitDistance({ w: 0.352, h: 0.471 }, { w: 1440, h: 900 }, { w: 1028, h: 900 });
    expect(d).toBeGreaterThan(1.3);
    expect(d).toBeLessThan(1.4);
  });

  it('backs off on a portrait phone so the width still fits', () => {
    const phone = fitDistance({ w: 0.352, h: 0.471 }, { w: 390, h: 844 }, { w: 390, h: 544 });
    const wide = fitDistance({ w: 0.352, h: 0.471 }, { w: 390, h: 844 }, { w: 390, h: 844 });
    expect(phone).toBeGreaterThan(wide);
    const k = 2 * Math.tan((28 * Math.PI) / 360);
    expect(0.352 / (k * phone * (390 / 844))).toBeLessThanOrEqual(0.92 + 1e-9);
  });

  it('starts in front of the patient, toward their left and slightly above', () => {
    const p = homePosition(1.35);
    expect(p.length()).toBeCloseTo(1.35);
    expect(p.z).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    expect((Math.atan2(p.x, p.z) * 180) / Math.PI).toBeCloseTo(24);
    expect((Math.asin(p.y / 1.35) * 180) / Math.PI).toBeCloseTo(8);
  });
});
