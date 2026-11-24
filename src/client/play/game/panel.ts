import * as THREE from "three";
import { accuracy } from "../../../shared/protocol.ts";
import { CSS, PIXEL, TERMINAL } from "./palette.ts";
import { POWER_LABEL, type ViewModel } from "./types.ts";

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
    this.ctx.imageSmoothingEnabled = false;
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

  /** Cornice arcade: nero pieno, bordo spesso e scanline. */
  protected frameBox(x: number, y: number, w: number, h: number, color: string): void {
    const c = this.ctx;
    c.fillStyle = "rgba(0,0,0,0.88)";
    c.fillRect(x, y, w, h);
    c.strokeStyle = color;
    c.lineWidth = 8;
    c.strokeRect(x + 4, y + 4, w - 8, h - 8);
    c.fillStyle = "rgba(0,0,0,0.25)";
    for (let yy = y + 8; yy < y + h - 8; yy += 6) c.fillRect(x + 8, yy, w - 16, 2);
  }

  protected text(t: string, x: number, y: number, size: number, color: string, font = PIXEL, align: CanvasTextAlign = "left"): void {
    const c = this.ctx;
    c.font = `${size}px ${font}`;
    c.textAlign = align;
    c.fillStyle = color;
    c.fillText(t, x, y);
  }

  /** Testo con ombra spostata, come nei titoli dei cabinati. */
  protected title(t: string, x: number, y: number, size: number, color: string, shadow: string): void {
    this.text(t, x + size / 12, y + size / 12, size, shadow, PIXEL, "center");
    this.text(t, x, y, size, color, PIXEL, "center");
  }
}

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");

/** Striscia durante la partita: punti, vite, combo, potenziamenti. */
export class HudPanel extends CanvasPanel {
  constructor(ar: boolean) {
    super(1024, 300, ar ? 0.42 : 0.9, ar ? { dist: 1.1, drop: -0.17, speed: 3 } : { dist: 1.5, drop: -0.5, speed: 2.5 });
  }

  update(vm: ViewModel): void {
    const powers = vm.powers.map((p) => `${p.kind}:${Math.ceil(p.left)}`).join(",");
    const key = [vm.score, vm.lives, vm.combo, vm.wave, powers, vm.toast, vm.boss?.hp].join("|");
    this.redraw(key, () => {
      this.frameBox(0, 0, 1024, 300, CSS.cyan);
      this.text(vm.player.toUpperCase().slice(0, 12), 40, 66, 26, CSS.pink);
      this.text(pad(vm.score), 40, 150, 64, CSS.yellow);
      this.text(`ONDATA ${vm.wave}`, 40, 210, 48, CSS.cyan, TERMINAL);

      for (let i = 0; i < 5; i++) this.ship(640 + i * 66, 46, i < vm.lives ? CSS.pink : "#333");
      this.text(`x${vm.combo}`, 984, 170, 56, vm.combo > 1 ? CSS.green : "#555", PIXEL, "right");

      if (vm.boss) {
        const c = this.ctx;
        c.strokeStyle = CSS.pink;
        c.lineWidth = 4;
        c.strokeRect(640, 196, 344, 24);
        c.fillStyle = CSS.pink;
        c.fillRect(646, 202, (332 * vm.boss.hp) / vm.boss.max, 12);
      }
      const msg = vm.toast ?? vm.powers.map((p) => (p.total ? `${POWER_LABEL[p.kind]} ${Math.ceil(p.left)}s` : POWER_LABEL[p.kind])).join("  ").toUpperCase();
      if (msg) this.text(msg, 40, 268, 40, vm.toast ? CSS.yellow : CSS.green, TERMINAL);
    });
  }

  /** Navicella in pixel art (8×8) per le vite. */
  private ship(x: number, y: number, color: string): void {
    const rows = ["...##...", "...##...", "..####..", "..####..", ".######.", "########", "##.##.##", "#......#"];
    const c = this.ctx;
    c.fillStyle = color;
    rows.forEach((r, j) => [...r].forEach((ch, i) => ch === "#" && c.fillRect(x + i * 6, y + j * 6, 6, 6)));
  }
}

/** Schermate grandi: attesa, conto alla rovescia, risultato. */
export type CardAction = "play" | "menu" | "exit";

interface CardButton {
  id: CardAction;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
}

/**
 * Schermate grandi: menu, conto alla rovescia, risultato.
 * Ha pulsanti veri: si puntano con il raggio e si premono con grilletto o pizzico.
 */
export class CardPanel extends CanvasPanel {
  private buttons: CardButton[] = [];
  private hits: THREE.Intersection[] = [];

  constructor(ar: boolean) {
    super(1024, 720, ar ? 0.5 : 1.3, ar ? { dist: 1.2, drop: -0.02, speed: 2 } : { dist: 2, drop: -0.1, speed: 1.5 });
  }

  /** Quale pulsante colpisce il raggio (null se nessuno o se è disattivato). */
  hitTest(ray: THREE.Raycaster): CardAction | null {
    if (!this.mesh.visible || this.buttons.length === 0) return null;
    this.hits.length = 0;
    ray.intersectObject(this.mesh, false, this.hits);
    const uv = this.hits[0]?.uv;
    if (!uv) return null;
    const x = uv.x * this.w;
    const y = (1 - uv.y) * this.h;
    const b = this.buttons.find((b) => b.enabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return b?.id ?? null;
  }

  private button(b: CardButton, hover: boolean, primary: boolean): void {
    const c = this.ctx;
    const color = !b.enabled ? "#444" : primary ? CSS.yellow : CSS.cyan;
    if (hover && b.enabled) {
      c.fillStyle = color;
      c.fillRect(b.x, b.y, b.w, b.h);
    } else {
      c.fillStyle = "#000";
      c.fillRect(b.x, b.y, b.w, b.h);
    }
    c.strokeStyle = color;
    c.lineWidth = 6;
    c.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    this.text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 14, 28, hover && b.enabled ? "#000" : color, PIXEL, "center");
    this.buttons.push(b);
  }

  update(vm: ViewModel, hover: CardAction | null = null): void {
    const r = vm.result;
    const key = [vm.phase, vm.nextPlayer, vm.countdown, vm.player, r?.stats.score, r?.rankToday, r?.isRecord, Math.ceil(vm.lockout), vm.online, hover].join("|");
    this.redraw(key, () => {
      this.buttons = [];
      if (vm.phase === "countdown") {
        this.frameBox(0, 0, 1024, 720, CSS.yellow);
        this.title(String(Math.max(1, vm.countdown)), 512, 440, 280, CSS.yellow, CSS.pink);
        this.text(`PRONTI, ${vm.player.toUpperCase()}`, 512, 620, 56, CSS.white, TERMINAL, "center");
      } else if (vm.phase === "over" && r) {
        this.frameBox(0, 0, 1024, 720, CSS.pink);
        this.title("GAME OVER", 512, 110, 64, CSS.pink, CSS.cyan);
        this.text(`BEL VOLO, ${r.player.toUpperCase()}`, 512, 180, 52, CSS.white, TERMINAL, "center");
        this.text(pad(r.stats.score), 512, 290, 84, CSS.yellow, PIXEL, "center");
        const rank = r.isRecord ? "NUOVO RECORD!" : r.rankToday ? `${r.rankToday}° POSTO DI OGGI` : vm.online ? "SALVATAGGIO..." : "OFFLINE";
        this.text(rank, 512, 360, 30, r.isRecord ? CSS.yellow : CSS.green, PIXEL, "center");
        this.text(
          `${r.stats.kills} ASTEROIDI  ${r.stats.enemies} NEMICI  ${Math.round(accuracy(r.stats) * 100)}% PRECISIONE`,
          512,
          430,
          42,
          CSS.cyan,
          TERMINAL,
          "center",
        );
        const ready = vm.lockout <= 0;
        const again = vm.nextPlayer ? `GIOCA: ${vm.nextPlayer.toUpperCase().slice(0, 10)}` : "GIOCA ANCORA";
        this.button({ id: "play", label: again, x: 60, y: 500, w: 560, h: 110, enabled: ready }, hover === "play", true);
        this.button({ id: "menu", label: "MENU", x: 660, y: 500, w: 304, h: 110, enabled: ready }, hover === "menu", false);
        this.text(ready ? "punta un pulsante e premi" : "togli pure il visore", 512, 670, 40, CSS.grey, TERMINAL, "center");
      } else {
        this.frameBox(0, 0, 1024, 720, CSS.cyan);
        this.title("ORBITA", 512, 140, 96, CSS.yellow, CSS.pink);
        this.text(vm.nextPlayer ? `TOCCA A ${vm.nextPlayer.toUpperCase()}` : "DIFENDI LA STAZIONE", 512, 240, 30, CSS.white, PIXEL, "center");
        this.text("mira con il raggio, grilletto o pizzico per sparare", 512, 320, 42, CSS.cyan, TERMINAL, "center");
        this.text("cristalli verdi = potenziamenti, frecce = pericoli fuori vista", 512, 370, 40, CSS.green, TERMINAL, "center");
        this.button({ id: "play", label: "GIOCA", x: 60, y: 450, w: 560, h: 120, enabled: true }, hover === "play", true);
        this.button({ id: "exit", label: "ESCI", x: 660, y: 450, w: 304, h: 120, enabled: true }, hover === "exit", false);
        this.text(vm.online ? "il punteggio va nella classifica della fiera" : "server non collegato: punteggio non salvato", 512, 650, 38, vm.online ? CSS.grey : CSS.pink, TERMINAL, "center");
      }
    });
  }
}
