import { Color, FrontSide, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from 'three';

export type Quality = 'full' | 'lite';

export interface Materials {
  quality: Quality;
  bone: Material;
  skin: MeshPhysicalMaterial;
}

// The numbers below are starting guesses tuned by eye against renders (see the build notes).
const LITE_SKIN_OPACITY = 0.26;

export function createMaterials(quality: Quality): Materials {
  if (quality === 'lite') {
    return {
      quality,
      bone: new MeshStandardMaterial({ color: 0xe0edff, roughness: 0.5, metalness: 0 }),
      skin: new MeshPhysicalMaterial({
        color: 0xbfdbfe,
        transparent: true,
        opacity: LITE_SKIN_OPACITY,
        depthWrite: false,
        roughness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        sheen: 1,
        sheenColor: new Color(0x1d4ed8),
        sheenRoughness: 0.4,
        side: FrontSide,
      }),
    };
  }
  return {
    quality,
    bone: new MeshPhysicalMaterial({
      color: 0xe0edff,
      roughness: 0.45,
      metalness: 0,
      clearcoat: 0.15,
      clearcoatRoughness: 0.5,
      sheen: 0.6,
      sheenColor: new Color(0xbfdbfe),
      sheenRoughness: 0.5,
    }),
    skin: new MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      thickness: 18,
      ior: 1.2,
      roughness: 0.08,
      metalness: 0,
      attenuationColor: new Color(0x3b82f6),
      attenuationDistance: 0.065,
      specularIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      sheen: 1,
      sheenColor: new Color(0x2563eb),
      sheenRoughness: 0.28,
      side: FrontSide,
    }),
  };
}

/** Sets how much skin shows: 1 is fully there, 0 is gone. Transmission is the dial for full quality, opacity for lite. */
export function setSkinLevel(m: Materials, level: number): void {
  if (m.quality === 'full') m.skin.transmission = level;
  else m.skin.opacity = LITE_SKIN_OPACITY * level;
}

export function disposeMaterials(m: Materials): void {
  m.bone.dispose();
  m.skin.dispose();
}
