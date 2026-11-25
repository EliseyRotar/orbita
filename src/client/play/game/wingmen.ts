import * as THREE from "three";
import type { OtherPilot } from "../../../shared/protocol.ts";
import { instance, type Models } from "../../common/assets.ts";
import { C, CSS, PIXEL } from "./palette.ts";

/**
 * Gregari fantasma: una navicella in lontananza per ogni altro pilota in partita, con il
 * nome sopra. Non si possono colpire e non interagiscono: servono a far capire che
 * nella stanza stanno giocando anche gli altri.
 */
interface Wingman {
  id: string;
  group: THREE.Group;
  label: THREE.Sprite;
  labelKey: string;
  slot: number;
  t: number;
}

export class Wingmen {
  readonly group = new THREE.Group();
  private list = new Map<string, Wingman>();
  private glowMat: THREE.SpriteMaterial;

  constructor(private readonly models: Models | null) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    this.glowMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      color: C.cyan,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  set(pilots: OtherPilot[]): void {
    const seen = new Set<string>();
    pilots.slice(0, 5).forEach((p, i) => {
      seen.add(p.id);
      let w = this.list.get(p.id);
      if (!w) {
        w = this.make(p.id, i);
        this.list.set(p.id, w);
        this.group.add(w.group);
      }
      const key = `${p.player}|${p.score}`;
      if (w.labelKey !== key) {
        w.labelKey = key;
        this.drawLabel(w.label, p);
      }
    });
    for (const [id, w] of this.list) {
      if (seen.has(id)) continue;
      this.group.remove(w.group);
      (w.label.material as THREE.SpriteMaterial).map?.dispose();
      w.label.material.dispose();
      this.list.delete(id);
    }
  }

  private make(id: string, slot: number): Wingman {
    const group = new THREE.Group();
    if (this.models) {
      const ship = instance(this.models, "wingman");
      ship.scale.setScalar(1.6);
      group.add(ship);
    }
    const flame = new THREE.Sprite(this.glowMat);
    flame.scale.setScalar(1.4);
    flame.position.z = 1.3;
    group.add(flame);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.scale.set(11, 2.75, 1);
    label.position.y = 2.6;
    group.add(label);
    return { id, group, label, labelKey: "", slot, t: Math.random() * 10 };
  }

  private drawLabel(sprite: THREE.Sprite, p: OtherPilot): void {
    const tex = (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
    const c = (tex.image as HTMLCanvasElement).getContext("2d")!;
    c.clearRect(0, 0, 512, 128);
    c.textAlign = "center";
    c.font = `30px ${PIXEL}`;
    c.fillStyle = "#000";
    c.fillText(p.player.toUpperCase().slice(0, 12), 259, 53);
    c.fillStyle = CSS.yellow;
    c.fillText(p.player.toUpperCase().slice(0, 12), 256, 50);
    c.font = `24px ${PIXEL}`;
    c.fillStyle = CSS.cyan;
    c.fillText(String(p.score).padStart(6, "0"), 256, 100);
    tex.needsUpdate = true;
  }

  /** Volano in formazione lontano, ai lati del campo di battaglia, ondeggiando. */
  update(dt: number): void {
    for (const w of this.list.values()) {
      w.t += dt;
      const side = w.slot % 2 === 0 ? -1 : 1;
      const row = Math.floor(w.slot / 2);
      const az = side * (0.95 + row * 0.22) + Math.sin(w.t * 0.3) * 0.08;
      const dist = 34 + row * 6;
      w.group.position.set(Math.sin(az) * dist, 7 + row * 3 + Math.sin(w.t * 0.8) * 1.2, -Math.cos(az) * dist);
      // muso in avanti (verso -Z), con un leggero rollio
      w.group.rotation.set(0, 0, Math.sin(w.t * 0.8) * 0.35);
    }
  }
}
