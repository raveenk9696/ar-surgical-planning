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

/** Rotation about Y that turns a model's +Z (the patient's front) from `model` toward `viewer`. */
export function yawToward(model: Vector3, viewer: Vector3): number {
  return Math.atan2(viewer.x - model.x, viewer.z - model.z);
}

/** Pose for the model `m` metres ahead of the viewer, half a metre below eye height, front toward the viewer. */
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
