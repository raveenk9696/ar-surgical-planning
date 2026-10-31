import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../types';

const MM = 0.001;

/** LPS millimetres to a Y-up metre frame: (x, y, z) mm becomes (x, z, -y) m. Head +Y, patient-left +X, anterior +Z, no mirror. */
export const patientMatrix: Matrix4 = new Matrix4()
  .makeRotationX(-Math.PI / 2)
  .multiply(new Matrix4().makeScale(MM, MM, MM));

export function lpsToRig(v: Vec3, out: Vector3): Vector3 {
  return out.set(v[0] * MM, v[2] * MM, -v[1] * MM);
}

export function rigToLps(v: Vector3): Vec3 {
  return [v.x / MM, 0 - v.z / MM, v.y / MM];
}

export function lpsDirToRig(n: Vec3): Vector3 {
  return new Vector3(n[0], n[2], -n[1]);
}

export function rigDirToLps(d: Vector3): Vec3 {
  return [d.x, 0 - d.z, d.y];
}

export function yawToward(model: Vector3, viewer: Vector3): number {
  return Math.atan2(viewer.x - model.x, viewer.z - model.z);
}

export function placeInFront(viewer: Matrix4, m: number): Matrix4 {
  const eye = new Vector3().setFromMatrixPosition(viewer);
  const ahead = new Vector3(0, 0, -1).transformDirection(viewer);
  ahead.y = 0;
  if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
  ahead.normalize();
  const at = eye.clone().addScaledVector(ahead, m);
  at.y = eye.y - 0.5;
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yawToward(at, eye));
  return new Matrix4().compose(at, yaw, new Vector3(1, 1, 1));
}

export const CAMERA_FOV_DEG = 28;
export const HOME_AZIMUTH_DEG = 24;
export const HOME_ELEVATION_DEG = 8;

/**
 * Camera distance (m) at which the model fills `fill` of the free area's height and at most `maxWidthFill` of its width.
 * `view` is the whole canvas and `area` the part of it left free of panels, both in CSS px.
 */
export function fitDistance(
  model: { w: number; h: number },
  view: { w: number; h: number },
  area: { w: number; h: number },
  fovDeg: number = CAMERA_FOV_DEG,
  fill = 0.7,
  maxWidthFill = 0.92,
): number {
  const k = 2 * Math.tan((fovDeg * Math.PI) / 360);
  const byHeight = (model.h * view.h) / (k * fill * area.h);
  const byWidth = (model.w * view.h) / (k * maxWidthFill * area.w);
  return Math.max(byHeight, byWidth);
}

export function homePosition(distance: number, azimuthDeg = HOME_AZIMUTH_DEG, elevationDeg = HOME_ELEVATION_DEG): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(distance);
}
