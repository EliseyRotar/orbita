import * as THREE from "three";
import { C } from "./palette.ts";

const MAX = 8;
const m4 = new THREE.Matrix4();
const v = new THREE.Vector3();

/**
 * Frecce ai bordi della vista, come nei vecchi arcade: indicano da che parte arriva
 * un pericolo che il giocatore non sta guardando. Indispensabili sull'HoloLens,
 * che vede solo un rettangolo stretto davanti agli occhi.
 * Le frecce sono attaccate alla telecamera, su un'ellisse a 1 metro di distanza.
 */
export class OffscreenArrows {
  readonly group = new THREE.Group();
  private arrows: THREE.Mesh[] = [];
  private t = 0;

  /**
   * @param halfH metà del campo visivo orizzontale (radianti)
   * @param halfV metà del campo visivo verticale (radianti)
   */
  constructor(
    private readonly halfH: number,
    private readonly halfV: number,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.5);
    shape.lineTo(0.45, -0.35);
    shape.lineTo(0, -0.12);
    shape.lineTo(-0.45, -0.35);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    for (let i = 0; i < MAX; i++) {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: C.yellow, transparent: true, depthTest: false, depthWrite: false }),
      );
      mesh.renderOrder = 1100;
      mesh.visible = false;
      this.group.add(mesh);
      this.arrows.push(mesh);
    }
  }

  update(dt: number, camera: THREE.Camera, threats: { pos: THREE.Vector3; danger: boolean }[], count: number): void {
    this.t += dt;
    m4.copy(camera.matrixWorld).invert();
    // l'ellisse sta un po' dentro il bordo della vista, a 1 m davanti agli occhi
    const rx = Math.tan(this.halfH) * 0.82;
    const ry = Math.tan(this.halfV) * 0.78;
    const tanH = Math.tan(this.halfH);
    const tanV = Math.tan(this.halfV);
    const size = ry * 0.22;
    let used = 0;
    for (let i = 0; i < count && used < MAX; i++) {
      const th = threats[i]!;
      v.copy(th.pos).applyMatrix4(m4);
      const inFront = v.z < 0;
      const visible = inFront && Math.abs(v.x / -v.z) < tanH * 0.9 && Math.abs(v.y / -v.z) < tanV * 0.9;
      if (visible) continue;
      // direzione sullo schermo; se è dietro le spalle si usa solo il lato (destra/sinistra)
      let ax = v.x;
      let ay = inFront ? v.y : v.y * 0.3;
      if (Math.abs(ax) + Math.abs(ay) < 1e-4) ax = 1;
      const ang = Math.atan2(ay, ax);
      const a = this.arrows[used++]!;
      a.visible = true;
      a.position.set(Math.cos(ang) * rx, Math.sin(ang) * ry, -1);
      a.rotation.set(0, 0, ang - Math.PI / 2);
      a.scale.setScalar(size * (th.danger ? 1.25 : 1));
      const mat = a.material as THREE.MeshBasicMaterial;
      mat.color.setHex(th.danger ? C.pink : C.yellow);
      mat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(this.t * (th.danger ? 9 : 5)));
    }
    for (let i = used; i < MAX; i++) this.arrows[i]!.visible = false;
  }

  hide(): void {
    for (const a of this.arrows) a.visible = false;
  }
}
