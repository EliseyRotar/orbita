import * as THREE from "three";
import { accuracy } from "../../../shared/protocol.ts";
import { CSS } from "./palette.ts";
import { POWER_LABEL, type ViewModel } from "./types.ts";

const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
const TEXT = '"Atkinson Hyperlegible", Arial, sans-serif';

/**
 * Pannello disegnato su canvas e mostrato come piano nella scena 3D.
 * Segue lo sguardo "a distanza" (tag-along): resta leggibile anche col campo
 * visivo stretto dell'HoloLens senza essere incollato agli occhi.
 */
class CanvasPanel {
  readonly mesh: THREE.Mesh;
  protected ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private lastKey = "";
  private placed = false;

  constructor(
    protected w: number,
    protected h: number,
    widthMeters: number,
    private follow: { dist: number; drop: number; speed: number },
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    this.ctx = canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(widthMeters, (widthMeters * h) / w),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.mesh.renderOrder = 1000;
  }

  /** Ridisegna solo quando il contenuto cambia (il canvas è costoso sui visori). */
  protected redraw(key: string, draw: () => void): void {
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.ctx.clearRect(0, 0, this.w, this.h);
    draw();
    this.tex.needsUpdate = true;
  }

  place(head: THREE.Vector3, headQuat: THREE.Quaternion, dt: number): void {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(headQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const target = head.clone().addScaledVector(fwd, this.follow.dist);
    target.y += this.follow.drop;
    if (!this.placed) {
      this.mesh.position.copy(target);
      this.placed = true;
    } else {
      this.mesh.position.lerp(target, 1 - Math.exp(-this.follow.speed * dt));
    }
    this.mesh.lookAt(head);
  }

  resetPlacement(): void {
    this.placed = false;
  }

  protected panelBg(x: number, y: number, w: number, h: number, alpha = 0.86): void {
    const c = this.ctx;
    c.fillStyle = `rgba(10, 18, 64, ${alpha})`;
    c.beginPath();
    c.roundRect(x, y, w, h, 28);
    c.fill();
    c.strokeStyle = CSS.signal;
    c.lineWidth = 6;
    c.stroke();
  }
}

/** Striscia in basso durante la partita: punti, vite, combo, potenziamenti. */
export class HudPanel extends CanvasPanel {
  constructor(ar: boolean) {
    super(1024, 300, ar ? 0.42 : 0.9, ar ? { dist: 1.1, drop: -0.17, speed: 3 } : { dist: 1.5, drop: -0.5, speed: 2.5 });
  }

  update(vm: ViewModel): void {
    const powers = vm.powers.map((p) => `${p.kind}:${Math.ceil(p.left)}`).join(",");
    const key = [vm.score, vm.lives, vm.combo, vm.wave, powers, vm.toast, vm.boss?.hp].join("|");
    this.redraw(key, () => {
      const c = this.ctx;
      this.panelBg(8, 8, 1008, 284);
      c.textBaseline = "alphabetic";
      c.fillStyle = CSS.paper;
      c.font = `800 150px ${DISPLAY}`;
      c.fillText(String(vm.score), 44, 168);
      c.font = `700 40px ${TEXT}`;
      c.fillStyle = CSS.ice;
      c.fillText(`Ondata ${vm.wave}`, 48, 236);

      // vite
      for (let i = 0; i < 5; i++) {
        c.fillStyle = i < vm.lives ? CSS.coral : "rgba(244,246,255,0.15)";
        c.beginPath();
        const x = 640 + i * 70;
        c.moveTo(x, 60);
        c.lineTo(x + 26, 110);
        c.lineTo(x - 26, 110);
        c.closePath();
        c.fill();
      }
      c.font = `800 72px ${DISPLAY}`;
      c.fillStyle = vm.combo > 1 ? CSS.signal : "rgba(244,246,255,0.35)";
      c.fillText(`x${vm.combo}`, 640 - 26, 200);

      if (vm.boss) {
        c.fillStyle = "rgba(255,93,115,0.25)";
        c.fillRect(780, 160, 200, 26);
        c.fillStyle = CSS.coral;
        c.fillRect(780, 160, (200 * vm.boss.hp) / vm.boss.max, 26);
      }
      const msg = vm.toast ?? vm.powers.map((p) => (p.total ? `${POWER_LABEL[p.kind]} ${Math.ceil(p.left)}s` : POWER_LABEL[p.kind])).join("  ·  ");
      if (msg) {
        c.font = `700 38px ${TEXT}`;
        c.fillStyle = vm.toast ? CSS.signal : CSS.ice;
        c.fillText(msg, 330, 262);
      }
    });
  }
}

/** Schermate grandi: attesa, conto alla rovescia, risultato. */
export class CardPanel extends CanvasPanel {
  constructor(ar: boolean) {
    super(1024, 640, ar ? 0.5 : 1.3, ar ? { dist: 1.2, drop: -0.02, speed: 2 } : { dist: 2, drop: -0.1, speed: 1.5 });
  }

  update(vm: ViewModel): void {
    const r = vm.result;
    const key = [vm.phase, vm.nextPlayer, vm.countdown, vm.player, r?.stats.score, r?.rankToday, r?.isRecord, Math.ceil(vm.lockout), vm.online].join("|");
    this.redraw(key, () => {
      const c = this.ctx;
      this.panelBg(10, 10, 1004, 620);
      c.textAlign = "center";
      if (vm.phase === "countdown") {
        c.font = `800 360px ${DISPLAY}`;
        c.fillStyle = CSS.signal;
        c.fillText(String(Math.max(1, vm.countdown)), 512, 440);
        c.font = `700 44px ${TEXT}`;
        c.fillStyle = CSS.paper;
        c.fillText(`Pronti, ${vm.player}`, 512, 560);
      } else if (vm.phase === "over" && r) {
        c.font = `700 44px ${TEXT}`;
        c.fillStyle = CSS.ice;
        c.fillText(`Bel volo, ${r.player}`, 512, 100);
        c.font = `800 230px ${DISPLAY}`;
        c.fillStyle = CSS.paper;
        c.fillText(String(r.stats.score), 512, 310);
        c.font = `700 46px ${TEXT}`;
        c.fillStyle = r.isRecord ? CSS.signal : CSS.paper;
        const rank = r.isRecord ? "Nuovo record della fiera!" : r.rankToday ? `${r.rankToday}° posto di oggi` : "Salvataggio…";
        c.fillText(rank, 512, 385);
        c.font = `400 36px ${TEXT}`;
        c.fillStyle = CSS.ice;
        c.fillText(
          `${r.stats.kills} asteroidi · precisione ${Math.round(accuracy(r.stats) * 100)}% · combo x${r.stats.maxCombo}`,
          512,
          450,
        );
        c.font = `700 40px ${TEXT}`;
        c.fillStyle = vm.lockout > 0 ? "rgba(244,246,255,0.4)" : CSS.signal;
        const next = vm.nextPlayer ? `Tocca a ${vm.nextPlayer}: premi per partire` : "Passa il visore al prossimo pilota";
        c.fillText(vm.lockout > 0 ? "Togli pure il visore" : next, 512, 570);
      } else {
        c.font = `800 120px ${DISPLAY}`;
        c.fillStyle = CSS.signal;
        c.fillText("Orbita", 512, 170);
        c.font = `700 52px ${TEXT}`;
        c.fillStyle = CSS.paper;
        c.fillText(vm.nextPlayer ? `Tocca a ${vm.nextPlayer}` : "Difendi la stazione dagli asteroidi", 512, 280);
        c.font = `400 38px ${TEXT}`;
        c.fillStyle = CSS.ice;
        c.fillText("Mira con il raggio, premi il grilletto", 512, 370);
        c.fillText("o fai il gesto di pizzico per sparare", 512, 420);
        c.font = `700 44px ${TEXT}`;
        c.fillStyle = CSS.signal;
        c.fillText("Premi per iniziare", 512, 540);
        if (!vm.online) {
          c.font = `400 28px ${TEXT}`;
          c.fillStyle = CSS.coral;
          c.fillText("Non collegato al server: il punteggio non andrà in classifica", 512, 600);
        }
      }
      c.textAlign = "left";
    });
  }
}
