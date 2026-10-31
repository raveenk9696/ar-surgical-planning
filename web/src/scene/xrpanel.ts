import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Raycaster } from 'three';

export type PanelId = 'skin' | 'size' | 'move' | 'note' | 'exit';

const ORDER: readonly PanelId[] = ['skin', 'size', 'move', 'note', 'exit'];
const W = 0.12;
const H = 0.04;
const STEP = 0.05;

function draw(label: string, on: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 160;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.beginPath();
    ctx.roundRect(4, 4, 472, 152, 76);
    ctx.fillStyle = on ? '#e0edff' : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = on ? '#2563eb' : '#cbd5e1';
    ctx.stroke();
    ctx.font = '600 56px "Inter Variable", Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? '#2563eb' : '#0b1f3a';
    ctx.fillText(label, 240, 84);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface XrPanel {
  readonly group: Group;
  hit(ray: Raycaster): PanelId | null;
  setLabel(id: PanelId, label: string, on?: boolean): void;
  /** Keeps the panel 0.12 x 0.04 m in the world however the model is scaled, and parks it beside the model. */
  place(stageScale: number, modelWidthM: number): void;
  dispose(): void;
}

export function createXrPanel(parent: Group): XrPanel {
  const group = new Group();
  const geo = new PlaneGeometry(W, H);
  const planes = new Map<PanelId, Mesh<PlaneGeometry, MeshBasicMaterial>>();
  for (const [i, id] of ORDER.entries()) {
    const mesh = new Mesh(geo, new MeshBasicMaterial({ map: draw(id, false), transparent: true, toneMapped: false, depthTest: false }));
    mesh.renderOrder = 20;
    mesh.position.y = (2 - i) * STEP;
    mesh.userData = { id };
    group.add(mesh);
    planes.set(id, mesh);
  }
  parent.add(group);

  return {
    group,
    hit(ray) {
      const found = ray.intersectObjects([...planes.values()], false)[0];
      const id: unknown = found?.object.userData.id;
      return typeof id === 'string' && ORDER.includes(id as PanelId) ? (id as PanelId) : null;
    },
    setLabel(id, label, on = false) {
      const mesh = planes.get(id);
      if (!mesh) return;
      mesh.material.map?.dispose();
      mesh.material.map = draw(label, on);
      mesh.material.needsUpdate = true;
    },
    place(stageScale, modelWidthM) {
      group.scale.setScalar(1 / stageScale);
      group.position.set(-(modelWidthM / 2 + 0.09 / stageScale), 0, 0.12 / stageScale);
    },
    dispose() {
      group.removeFromParent();
      for (const m of planes.values()) {
        m.material.map?.dispose();
        m.material.dispose();
      }
      geo.dispose();
    },
  };
}
