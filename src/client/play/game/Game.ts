import * as THREE from "three";
import { ENT, type EntityKind, type FrameEntity, type GameFrame, type GameStats } from "../../../shared/protocol.ts";
import { instance, type Models } from "../../common/assets.ts";
import type { Sfx } from "./audio.ts";
import { Sparks } from "./fx.ts";
import { C } from "./palette.ts";
import * as R from "./rules.ts";
import {
  POWER_LABEL,
  type ActivePower,
  type Aimer,
  type GameCallbacks,
  type Mode,
  type Phase,
  type PowerKind,
  type ResultInfo,
  type ViewModel,
} from "./types.ts";

interface Rock {
  id: number;
  kind: R.RockKind;
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  hp: number;
  radius: number;
  flash: number;
}

interface Enemy {
  id: number;
  obj: THREE.Object3D;
  hp: number;
  t: number;
  az: number;
  el: number;
  phase: number;
  fireIn: number;
  flash: number;
}

interface Bolt {
  id: number;
  hand: number;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  alive: boolean;
}

interface Mine {
  id: number;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  alive: boolean;
}

interface Boss {
  group: THREE.Group;
  ring: THREE.Mesh;
  hp: number;
  max: number;
  index: number;
  t: number;
  fireIn: number;
  flash: number;
  bar: THREE.Mesh;
}

const COUNTDOWN = 2.4;
const OVER_LOCK = 3;
const ENEMY_LIFETIME = 16;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ROCK_MODEL: Record<R.RockKind, "meteor" | "meteorB" | "crystal"> = {
  small: "meteorB",
  medium: "meteor",
  large: "meteor",
  gold: "crystal",
};
const ENEMY_MODELS = ["enemyA", "enemyB", "enemyC"] as const;

/**
 * Logica di gioco comune a tutte le modalità. Riceve i "puntatori" (mouse,
 * controller, mani) e la posizione della testa; produce un ViewModel per l'interfaccia
 * e, quando qualcuno guarda dal monitor spettatore, i fotogrammi da trasmettere.
 */
export class Game {
  readonly root = new THREE.Group();
  readonly scale: number;
  private sparks: Sparks;
  private boltGeo: THREE.BufferGeometry;
  private boltMat: THREE.MeshBasicMaterial;
  private mineGeo: THREE.BufferGeometry;
  private mineMat: THREE.MeshBasicMaterial;
  private shieldBubble: THREE.Mesh;
  private hurtBubble: THREE.Mesh;

  private rocks: Rock[] = [];
  private enemies: Enemy[] = [];
  private bolts: Bolt[] = [];
  private mines: Mine[] = [];
  private boss: Boss | null = null;
  private nextId = 1;

  phase: Phase = "lobby";
  player = "Ospite";
  nextPlayer: string | null = null;
  online = false;

  private score = 0;
  private lives = R.START_LIVES;
  private wave = 1;
  private waveT = 0;
  private spawnIn = 1;
  private streak = 0;
  private comboT = 0;
  private maxCombo = 1;
  private kills = 0;
  private enemyKills = 0;
  private shots = 0;
  private hits = 0;
  private bossesBeaten = 0;
  private startedAt = 0;
  private countdown = 0;
  private overT = 0;
  /** Tempo di ricarica separato per ogni mano: si spara con due pistole insieme. */
  private fireCd = new Map<number, number>();
  /** Nome usato se nessuno scrive il proprio: il nome della postazione. */
  defaultName = "Ospite";
  /** Mano dell'ultimo colpo andato a segno (per far vibrare il controller giusto). */
  private lastHand = -1;
  private rings: { mesh: THREE.Mesh; t: number; size: number }[] = [];
  private flashes: { mesh: THREE.Mesh; t: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private flashGeo = new THREE.SphereGeometry(1, 10, 8);
  private dust: THREE.Points | null = null;
  private powers: ActivePower[] = [];
  private toast: string | null = null;
  private toastT = 0;
  private hurtT = 0;
  private result: ResultInfo | null = null;
  private tickT = 0;

  /** Posizione della testa e direzione "avanti" fissate a inizio partita. */
  private anchor = new THREE.Vector3(0, 1.6, 0);
  private forward = new THREE.Vector3(0, 0, -1);
  private right = new THREE.Vector3(1, 0, 0);
  private head = new THREE.Vector3(0, 1.6, 0);
  private headDir = new THREE.Vector3(0, 0, -1);

  constructor(
    readonly mode: Mode,
    private readonly sfx: Sfx,
    private readonly cb: GameCallbacks,
    private readonly models: Models,
  ) {
    const ar = mode === "ar";
    this.scale = ar ? 0.2 : 1;
    const s = this.scale;

    this.sparks = new Sparks(ar ? 0.025 : 0.13);
    // campo visivo dei visori: HoloLens 2 circa 43°×29°, Quest 2 circa 90°.
    // Gli oggetti nascono dentro questo cono, così si vedono arrivare.
    if (ar) this.cone = { az: 0.3, elMin: -0.12, elMax: 0.2 };
    else if (mode === "vr") this.cone = { az: 0.6, elMin: -0.1, elMax: 0.38 };
    this.root.add(this.sparks.object);

    this.boltGeo = new THREE.BoxGeometry(0.09 * s, 0.09 * s, 1.4 * s);
    this.boltMat = new THREE.MeshBasicMaterial({ color: C.cyan });
    this.mineGeo = new THREE.OctahedronGeometry(0.45 * s, 0);
    this.mineMat = new THREE.MeshBasicMaterial({ color: C.pink });

    this.shieldBubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 * s, 20, 12),
      new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false, wireframe: true }),
    );
    this.shieldBubble.visible = false;
    this.root.add(this.shieldBubble);
    this.hurtBubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.6 * s, 16, 12),
      new THREE.MeshBasicMaterial({ color: C.pink, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    this.hurtBubble.renderOrder = 999;
    this.root.add(this.hurtBubble);

    // polvere spaziale che scorre verso il giocatore: dà la sensazione di velocità (non in AR)
    if (!ar) {
      const n = 700;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 60, (Math.random() - 0.3) * 30, -Math.random() * 80], i * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      this.dust = new THREE.Points(
        g,
        new THREE.PointsMaterial({ color: C.cyan, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      this.dust.frustumCulled = false;
      this.root.add(this.dust);
    }
  }

  /** Torna al menu iniziale (dalla schermata di fine partita). */
  toLobby(): void {
    if (this.phase !== "over") return;
    this.clearField();
    this.result = null;
    this.phase = "lobby";
  }

  private fb(kind: import("./types.ts").Feedback, hand = this.lastHand): void {
    this.cb.onFeedback?.(kind, hand);
  }

  /** Lampo alla bocca della pistola. */
  private flash(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const s = this.scale;
    let f = this.flashes.find((x) => x.t <= 0);
    if (!f) {
      f = { mesh: new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, depthWrite: false })), t: 0 };
      this.flashes.push(f);
      this.root.add(f.mesh);
    }
    f.t = 0.07;
    f.mesh.visible = true;
    f.mesh.position.copy(origin).addScaledVector(dir, 0.25 * s);
    f.mesh.scale.setScalar(0.06 * s);
  }

  /** Onda d'urto: un anello che si allarga e svanisce, rivolto verso il giocatore. */
  private shockwave(at: THREE.Vector3, color: number, size: number): void {
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.copy(at);
    mesh.lookAt(this.head);
    this.root.add(mesh);
    this.rings.push({ mesh, t: 0, size });
  }

  private updateFx(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.t += dt;
      const k = r.t / 0.45;
      r.mesh.scale.setScalar(r.size * (0.2 + k));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.root.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      f.mesh.scale.multiplyScalar(1 + dt * 12);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.t / 0.07);
      if (f.t <= 0) f.mesh.visible = false;
    }
    if (this.dust) {
      // la polvere vive nel riferimento del giocatore e scorre verso di lui
      const speed = this.phase === "playing" ? (8 + this.wave) * (this.bossActive ? 1.6 : 1) : 3;
      const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let z = pos.getZ(i) + speed * dt;
        if (z > 2) z -= 82;
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      this.dust.position.copy(this.anchor);
      this.dust.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.forward);
    }
  }

  // ---------------- comandi ----------------

  /** Grilletto / click / tap fuori dalla partita: avvia se possibile. */
  press(headPos: THREE.Vector3, headDir: THREE.Vector3): void {
    if (this.phase === "lobby" || (this.phase === "over" && this.overT >= OVER_LOCK)) {
      this.begin(headPos, headDir);
    }
  }

  setNextPlayer(name: string | null): void {
    this.nextPlayer = name;
  }

  setRank(rankToday: number, rankAll: number, isRecord: boolean): void {
    if (!this.result) return;
    this.result.rankToday = rankToday;
    this.result.rankAll = rankAll;
    this.result.isRecord = isRecord;
  }

  /** L'operatore ha chiesto di chiudere la partita: viene salvata come normale game over. */
  forceEnd(): void {
    if (this.phase === "playing") this.gameOver();
    else if (this.phase === "countdown") {
      this.phase = "lobby";
      this.cb.onAbort();
    }
  }

  // ---------------- ciclo ----------------

  update(dt: number, headPos: THREE.Vector3, headDir: THREE.Vector3, aimers: Aimer[]): void {
    this.head.copy(headPos);
    this.headDir.copy(headDir);
    this.sparks.update(dt);
    this.updateEffects(dt);
    this.updateFx(dt);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = "playing";
        this.startedAt = performance.now();
        this.showToast("ONDATA 1");
      }
    } else if (this.phase === "over") {
      this.overT += dt;
    }

    if (this.phase === "playing") this.play(dt, aimers);
    else {
      this.moveRocks(dt, false);
      this.moveBolts(dt);
    }

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast = null;
    }
  }

  private begin(headPos: THREE.Vector3, headDir: THREE.Vector3): void {
    this.clearField();
    this.anchor.copy(headPos);
    this.forward.set(headDir.x, 0, headDir.z);
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.crossVectors(this.forward, UP).normalize();

    this.player = this.nextPlayer ?? this.defaultName;
    this.nextPlayer = null;
    this.score = 0;
    this.lives = R.START_LIVES;
    this.wave = 1;
    this.waveT = 0;
    this.spawnIn = 1.2;
    this.streak = 0;
    this.comboT = 0;
    this.maxCombo = 1;
    this.kills = 0;
    this.enemyKills = 0;
    this.shots = 0;
    this.hits = 0;
    this.bossesBeaten = 0;
    this.powers = [];
    this.result = null;
    this.countdown = COUNTDOWN;
    this.phase = "countdown";
    this.sfx.start();
    this.cb.onStart(this.player);
  }

  private play(dt: number, aimers: Aimer[]): void {
    const slow = this.hasPower("slow") ? 0.45 : 1;

    this.waveT += dt;
    this.followGaze(dt);
    if (!this.boss && this.waveT >= R.WAVE_SECONDS) this.nextWave();

    this.spawnIn -= dt;
    const interval = R.spawnInterval(this.wave) * (this.boss ? 3 : 1);
    if (this.spawnIn <= 0) {
      const wantEnemy = !this.boss && this.enemies.length < R.maxEnemies(this.wave) && Math.random() < R.enemyChance(this.wave);
      if (wantEnemy) this.spawnEnemy();
      else if (this.rocks.length < R.maxRocks(this.wave)) this.spawnRock(R.pickRock(this.wave));
      this.spawnIn = interval * (0.7 + Math.random() * 0.6);
    }

    for (const a of aimers) {
      const cd = (this.fireCd.get(a.hand) ?? 0) - dt;
      if (a.pressed || (a.held && cd <= 0)) {
        this.fire(a);
        this.fireCd.set(a.hand, R.FIRE_INTERVAL);
      } else {
        this.fireCd.set(a.hand, cd);
      }
    }

    this.moveBolts(dt);
    this.moveRocks(dt * slow, true);
    this.updateEnemies(dt * slow);
    this.updateBoss(dt * slow);
    this.moveMines(dt * slow);

    if (this.streak > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.streak = 0;
    }

    for (const p of this.powers) if (p.total > 0) p.left -= dt;
    this.powers = this.powers.filter((p) => p.total === 0 || p.left > 0);

    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.5;
      this.cb.onTick(this.score, this.lives, R.comboLevel(this.streak), this.wave);
    }
  }

  /**
   * Con il visore il "davanti" della partita segue piano lo sguardo (solo in orizzontale):
   * se il giocatore si gira, i nuovi nemici arrivano comunque dove sta guardando.
   */
  private followGaze(dt: number): void {
    if (this.desktop) return;
    const want = v1.set(this.headDir.x, 0, this.headDir.z);
    if (want.lengthSq() < 1e-4) return;
    want.normalize();
    this.forward.lerp(want, 1 - Math.exp(-0.7 * dt)).normalize();
    this.right.crossVectors(this.forward, UP).normalize();
  }

  /** Posizioni di tutto ciò che può colpire il giocatore, per le frecce ai bordi della vista. */
  threats(out: { pos: THREE.Vector3; danger: boolean }[]): number {
    let n = 0;
    const push = (pos: THREE.Vector3, danger: boolean) => {
      if (n >= out.length) out.push({ pos: new THREE.Vector3(), danger });
      out[n]!.pos.copy(pos);
      out[n]!.danger = danger;
      n++;
    };
    if (this.phase !== "playing") return 0;
    const near = R.SPAWN_DISTANCE * this.scale * 0.85;
    for (const r of this.rocks) if (r.obj.position.distanceTo(this.head) < near) push(r.obj.position, false);
    for (const e of this.enemies) push(e.obj.position, true);
    for (const m of this.mines) if (m.alive) push(m.mesh.position, true);
    if (this.boss) push(this.boss.group.position, true);
    return n;
  }

  private nextWave(): void {
    this.wave++;
    this.waveT = 0;
    if (R.isBossWave(this.wave)) {
      this.spawnBoss();
      this.showToast("BOSS IN ARRIVO!");
      this.sfx.bossAlarm();
      this.fb("boss", -1);
    } else {
      this.showToast(`ONDATA ${this.wave}`);
    }
  }

  // ---------------- entità ----------------

  /** Direzione nel cono davanti al giocatore. az/el in radianti. */
  private dirFrom(az: number, el: number, out: THREE.Vector3): THREE.Vector3 {
    return out
      .copy(this.forward)
      .multiplyScalar(Math.cos(az) * Math.cos(el))
      .addScaledVector(this.right, Math.sin(az) * Math.cos(el))
      .addScaledVector(UP, Math.sin(el));
  }

  /** Cono in cui nascono i nemici su PC/telefono (radianti): dipende dalla forma dello schermo. */
  private cone = { az: 0.62, elMin: -0.12, elMax: 0.3 };

  /** Su schermi stretti (telefono in verticale) gli oggetti devono nascere dentro l'inquadratura. */
  setViewCone(az: number, elMin: number, elMax: number): void {
    this.cone = { az, elMin, elMax };
  }

  private get desktop(): boolean {
    return this.mode === "desktop" || this.mode === "mobile";
  }

  private spawnRock(kind: R.RockKind, at?: THREE.Vector3, size?: number): void {
    const s = this.scale;
    const spec = R.ROCK[kind];
    const v = this.cone;
    const az = (Math.random() * 2 - 1) * v.az;
    const el = v.elMin + Math.random() * (v.elMax - v.elMin);
    const pos = at
      ? at.clone()
      : this.dirFrom(az, el, new THREE.Vector3()).multiplyScalar(R.SPAWN_DISTANCE * s).add(this.anchor);
    const radius = (size ?? spec.radius) * s;
    const obj = instance(this.models, ROCK_MODEL[kind]);
    obj.position.copy(pos);
    obj.scale.setScalar(radius);
    obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const target = v1
      .copy(this.head)
      .addScaledVector(this.right, (Math.random() - 0.5) * 0.9 * s)
      .addScaledVector(UP, (Math.random() - 0.5) * 0.6 * s);
    const vel = target.sub(pos).normalize().multiplyScalar(R.rockSpeed(this.wave) * spec.speed * s);
    if (at) vel.addScaledVector(this.right, (Math.random() - 0.5) * 3 * s);
    this.rocks.push({
      id: this.nextId++,
      kind,
      obj,
      vel: vel.clone(),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.2),
      hp: spec.hp,
      radius,
      flash: 0,
    });
    this.root.add(obj);
  }

  private moveRocks(dt: number, harmful: boolean): void {
    const s = this.scale;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i]!;
      r.obj.position.addScaledVector(r.vel, dt);
      r.obj.rotation.x += r.spin.x * dt;
      r.obj.rotation.y += r.spin.y * dt;
      if (r.flash > 0) {
        r.flash -= dt;
        r.obj.scale.setScalar(r.radius * (1 + Math.max(0, r.flash) * 1.8));
      }
      const d = r.obj.position.distanceTo(this.head);
      const passed = v2.copy(r.obj.position).sub(this.anchor).dot(this.forward) < -3 * s;
      if (harmful && d < R.HIT_RADIUS * s + r.radius * 0.5) {
        this.removeRock(i);
        this.takeDamage();
      } else if (passed || d > 60 * s) {
        this.removeRock(i);
      }
    }
  }

  private removeRock(i: number): void {
    const r = this.rocks[i]!;
    this.root.remove(r.obj);
    this.rocks.splice(i, 1);
  }

  private spawnEnemy(): void {
    const s = this.scale;
    const obj = instance(this.models, ENEMY_MODELS[Math.floor(Math.random() * ENEMY_MODELS.length)]!);
    obj.scale.setScalar(R.ENEMY.radius * s);
    const e: Enemy = {
      id: this.nextId++,
      obj,
      hp: R.ENEMY.hp,
      t: 0,
      az: (Math.random() * 2 - 1) * this.cone.az * 0.7,
      el: this.cone.elMin * 0.3 + Math.random() * this.cone.elMax * 0.6,
      phase: Math.random() * Math.PI * 2,
      fireIn: 2.5 + Math.random(),
      flash: 0,
    };
    this.placeEnemy(e);
    this.enemies.push(e);
    this.root.add(obj);
  }

  /** Volo: arriva da lontano, si ferma a media distanza ondeggiando, poi se ne va. */
  private placeEnemy(e: Enemy): void {
    const s = this.scale;
    const arrive = Math.min(1, e.t / 5);
    const leave = Math.max(0, (e.t - ENEMY_LIFETIME + 3) / 3);
    const dist = (40 - 24 * (1 - (1 - arrive) ** 2) + 30 * leave * leave) * s;
    const az = e.az + Math.sin(e.t * 0.7 + e.phase) * 0.28;
    const el = e.el + Math.sin(e.t * 1.1 + e.phase) * 0.06;
    e.obj.position.copy(this.dirFrom(az, el, v1).multiplyScalar(dist).add(this.anchor));
    e.obj.lookAt(this.head);
    // i modelli Kenney hanno il muso verso -Z: lookAt punta +Z, quindi si girano
    e.obj.rotateY(Math.PI);
    e.obj.rotateZ(Math.sin(e.t * 0.7 + e.phase) * 0.5);
  }

  private updateEnemies(dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]!;
      e.t += dt;
      this.placeEnemy(e);
      if (e.flash > 0) {
        e.flash -= dt;
        e.obj.scale.setScalar(R.ENEMY.radius * this.scale * (1 + Math.max(0, e.flash) * 1.5));
      }
      e.fireIn -= dt;
      if (e.fireIn <= 0 && e.t > 3 && e.t < ENEMY_LIFETIME - 3) {
        e.fireIn = R.enemyFireInterval(this.wave);
        this.spawnMine(e.obj.position, 6);
        this.sfx.enemyShoot();
      }
      if (e.t > ENEMY_LIFETIME) {
        this.root.remove(e.obj);
        this.enemies.splice(i, 1);
      }
    }
  }

  private damageEnemy(i: number): void {
    const e = this.enemies[i]!;
    e.hp--;
    e.flash = 0.08;
    if (e.hp > 0) {
      this.sfx.hit();
      this.fb("hit");
      this.sparks.burst(e.obj.position, C.yellow, 8, 3 * this.scale);
      return;
    }
    this.sparks.burst(e.obj.position, C.yellow, 50, 9 * this.scale);
    this.sparks.burst(e.obj.position, C.white, 30, 5 * this.scale);
    this.sfx.explode(true);
    this.fb("kill");
    this.shockwave(e.obj.position, C.pink, R.ENEMY.radius * this.scale * 3);
    this.root.remove(e.obj);
    this.enemies.splice(i, 1);
    this.enemyKills++;
    this.registerKill(R.ENEMY.points);
  }

  private fire(a: Aimer): void {
    const s = this.scale;
    const spread = this.hasPower("triple") ? [-0.07, 0, 0.07] : [0];
    for (const ang of spread) {
      const dir = a.dir.clone();
      if (ang !== 0) dir.applyAxisAngle(UP, ang).normalize();
      let bolt = this.bolts.find((b) => !b.alive);
      if (!bolt) {
        bolt = { id: 0, hand: -1, mesh: new THREE.Mesh(this.boltGeo, this.boltMat), vel: new THREE.Vector3(), life: 0, alive: false };
        this.bolts.push(bolt);
        this.root.add(bolt.mesh);
      }
      bolt.id = this.nextId++;
      bolt.hand = a.hand;
      bolt.alive = true;
      bolt.mesh.visible = true;
      bolt.life = 1.1;
      bolt.mesh.position.copy(a.origin).addScaledVector(dir, 0.3 * s);
      bolt.mesh.lookAt(v1.copy(bolt.mesh.position).add(dir));
      bolt.vel.copy(dir).multiplyScalar(R.BOLT_SPEED * s);
      this.shots++;
    }
    this.sfx.shoot();
    this.fb("shoot", a.hand);
    this.flash(a.origin, a.dir);
  }

  private moveBolts(dt: number): void {
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const p0 = v1.copy(b.mesh.position);
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      if (b.life <= 0) {
        this.killBolt(b);
        continue;
      }
      this.lastHand = b.hand;
      if (this.phase === "playing" && this.boltHits(p0, b.mesh.position)) {
        this.hits++;
        this.killBolt(b);
      }
    }
  }

  private killBolt(b: Bolt): void {
    b.alive = false;
    b.mesh.visible = false;
  }

  /** Test segmento-sfera: il colpo ha attraversato qualcosa in questo frame? */
  private boltHits(p0: THREE.Vector3, p1: THREE.Vector3): boolean {
    const seg = v2.copy(p1).sub(p0);
    const len2 = seg.lengthSq();
    const tmp = new THREE.Vector3();
    const hitSphere = (c: THREE.Vector3, rad: number) => {
      const t = len2 > 0 ? Math.max(0, Math.min(1, tmp.subVectors(c, p0).dot(seg) / len2)) : 0;
      const cx = p0.x + seg.x * t - c.x;
      const cy = p0.y + seg.y * t - c.y;
      const cz = p0.z + seg.z * t - c.z;
      return cx * cx + cy * cy + cz * cz <= rad * rad;
    };
    const s = this.scale;

    for (const m of this.mines) {
      if (m.alive && hitSphere(m.mesh.position, 0.8 * s)) {
        this.sparks.burst(m.mesh.position, C.pink, 18, 5 * s);
        this.killMine(m);
        this.award(15);
        this.sfx.hit();
        this.fb("hit");
        return true;
      }
    }
    for (let i = 0; i < this.enemies.length; i++) {
      if (hitSphere(this.enemies[i]!.obj.position, R.ENEMY.radius * s * 1.25)) {
        this.damageEnemy(i);
        return true;
      }
    }
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i]!;
      // un po' di tolleranza: aiuta chi non ha mai giocato in VR
      if (hitSphere(r.obj.position, r.radius * 1.35)) {
        this.damageRock(i);
        return true;
      }
    }
    if (this.boss && hitSphere(this.boss.group.position, 3.6 * s)) {
      this.damageBoss();
      return true;
    }
    return false;
  }

  private damageRock(i: number): void {
    const r = this.rocks[i]!;
    r.hp--;
    r.flash = 0.08;
    if (r.hp > 0) {
      this.sfx.hit();
      this.fb("hit");
      this.sparks.burst(r.obj.position, C.white, 6, 3 * this.scale);
      return;
    }
    const pos = r.obj.position.clone();
    const color = r.kind === "gold" ? C.green : C.yellow;
    this.sparks.burst(pos, color, r.kind === "large" ? 60 : 30, 7 * this.scale);
    this.sfx.explode(r.kind === "large");
    this.fb("kill");
    this.shockwave(pos, r.kind === "gold" ? C.green : C.yellow, r.radius * 3);
    this.removeRock(i);
    this.kills++;
    this.registerKill(R.ROCK[r.kind].points);

    if (r.kind === "large") {
      this.spawnRock("medium", pos, R.ROCK.medium.radius);
      this.spawnRock("medium", pos, R.ROCK.medium.radius);
    } else if (r.kind === "medium" && Math.random() < 0.6) {
      this.spawnRock("small", pos, R.ROCK.small.radius);
      this.spawnRock("small", pos, R.ROCK.small.radius);
    } else if (r.kind === "gold") {
      this.grantPower();
    }
  }

  private registerKill(points: number): void {
    this.streak++;
    this.comboT = R.COMBO_WINDOW;
    const lvl = R.comboLevel(this.streak);
    if (lvl > this.maxCombo) this.maxCombo = lvl;
    if (this.streak % 4 === 0 && this.streak <= 16) {
      this.sfx.combo(lvl);
      this.showToast(`COMBO x${lvl}!`);
      if (lvl === 5) this.cb.onEvent("combo", "combo x5!");
    }
    this.award(points);
  }

  private award(base: number): void {
    this.score += R.pointsFor(base, this.streak, this.hasPower("double"));
  }

  private grantPower(): void {
    const options: PowerKind[] = ["triple", "slow", "shield", "double"];
    if (this.lives < R.MAX_LIVES) options.push("life", "life");
    const kind = options[Math.floor(Math.random() * options.length)]!;
    this.sfx.power();
    this.fb("power", -1);
    this.showToast(POWER_LABEL[kind].toUpperCase());
    if (kind === "life") {
      this.lives = Math.min(R.MAX_LIVES, this.lives + 1);
      return;
    }
    const total = { triple: 10, slow: 8, double: 15, shield: 0 }[kind];
    this.powers = this.powers.filter((p) => p.kind !== kind);
    this.powers.push({ kind, left: total, total });
  }

  private hasPower(kind: PowerKind): boolean {
    return this.powers.some((p) => p.kind === kind);
  }

  private takeDamage(): void {
    if (this.hasPower("shield")) {
      this.powers = this.powers.filter((p) => p.kind !== "shield");
      this.sfx.shieldHit();
      this.showToast("SCUDO ESAURITO");
      return;
    }
    this.lives--;
    this.streak = 0;
    this.hurtT = 0.5;
    this.sfx.damage();
    this.fb("damage", -1);
    if (this.lives <= 0) this.gameOver();
  }

  // ---------------- boss ----------------

  private spawnBoss(): void {
    const s = this.scale;
    const index = this.bossesBeaten;
    const group = new THREE.Group();
    const hull = instance(this.models, "boss");
    hull.scale.setScalar(4.2 * s);
    hull.rotation.y = Math.PI;
    group.add(hull);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.2 * s, 0.14 * s, 6, 48),
      new THREE.MeshBasicMaterial({ color: C.pink }),
    );
    group.add(ring);
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(5 * s, 0.32 * s),
      new THREE.MeshBasicMaterial({ color: C.pink, side: THREE.DoubleSide }),
    );
    bar.position.y = 4.6 * s;
    group.add(bar);
    group.position.copy(this.dirFrom(0, 0.2, new THREE.Vector3()).multiplyScalar(42 * s).add(this.anchor));
    this.root.add(group);
    const max = R.bossHp(index);
    this.boss = { group, ring, hp: max, max, index, t: 0, fireIn: 2.5, flash: 0, bar };
    this.cb.onEvent("boss", "è arrivato il boss!");
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b) return;
    const s = this.scale;
    b.t += dt;
    const dist = Math.max(22, 42 - b.t * 6) * s;
    const az = Math.sin(b.t * 0.45) * Math.min(0.55, this.cone.az * 0.8);
    const el = 0.22 + Math.sin(b.t * 0.7) * 0.08;
    b.group.position.copy(this.dirFrom(az, el, v1).multiplyScalar(dist).add(this.anchor));
    b.group.lookAt(this.head);
    b.ring.rotation.z += dt * 1.5;
    b.bar.scale.x = Math.max(0.001, b.hp / b.max);
    if (b.flash > 0) {
      b.flash -= dt;
      b.group.scale.setScalar(1 + Math.max(0, b.flash) * 0.6);
    }
    b.fireIn -= dt;
    if (b.fireIn <= 0 && b.t > 3) {
      b.fireIn = R.mineInterval(b.index);
      this.spawnMine(b.group.position, 5.5);
    }
  }

  private damageBoss(): void {
    const b = this.boss!;
    b.hp--;
    b.flash = 0.06;
    this.sfx.hit();
    this.fb("hit");
    this.sparks.burst(b.group.position, C.yellow, 5, 4 * this.scale);
    if (b.hp > 0) return;
    const pos = b.group.position.clone();
    this.sparks.burst(pos, C.pink, 140, 15 * this.scale);
    this.sparks.burst(pos, C.yellow, 140, 9 * this.scale);
    this.sfx.explode(true);
    this.fb("boss", -1);
    this.shockwave(pos, C.pink, 12 * this.scale);
    this.shockwave(pos, C.yellow, 8 * this.scale);
    this.root.remove(b.group);
    this.boss = null;
    this.bossesBeaten++;
    this.score += R.bossReward(b.index) * (this.hasPower("double") ? 2 : 1);
    for (const m of this.mines) if (m.alive) this.killMine(m);
    this.showToast(`BOSS ABBATTUTO +${R.bossReward(b.index)}`);
    this.cb.onEvent("boss", `ha sconfitto il boss n° ${b.index + 1}`);
    this.nextWave();
  }

  private spawnMine(from: THREE.Vector3, speed: number): void {
    let m = this.mines.find((x) => !x.alive);
    if (!m) {
      m = { id: 0, mesh: new THREE.Mesh(this.mineGeo, this.mineMat), vel: new THREE.Vector3(), alive: false };
      this.mines.push(m);
      this.root.add(m.mesh);
    }
    m.id = this.nextId++;
    m.alive = true;
    m.mesh.visible = true;
    m.mesh.position.copy(from);
    m.vel.copy(this.head).sub(from).normalize().multiplyScalar(speed * this.scale);
  }

  private moveMines(dt: number): void {
    for (const m of this.mines) {
      if (!m.alive) continue;
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.rotation.y += dt * 5;
      m.mesh.rotation.x += dt * 3;
      if (m.mesh.position.distanceTo(this.head) < R.HIT_RADIUS * this.scale) {
        this.killMine(m);
        this.takeDamage();
      }
    }
  }

  private killMine(m: Mine): void {
    m.alive = false;
    m.mesh.visible = false;
  }

  // ---------------- fine partita ----------------

  private gameOver(): void {
    const stats: GameStats = {
      score: this.score,
      kills: this.kills,
      enemies: this.enemyKills,
      shots: this.shots,
      hits: this.hits,
      maxCombo: this.maxCombo,
      bosses: this.bossesBeaten,
      wave: this.wave,
      durationMs: Math.round(performance.now() - this.startedAt),
    };
    this.phase = "over";
    this.overT = 0;
    this.powers = [];
    this.result = { stats, player: this.player, rankToday: null, rankAll: null, isRecord: false };
    if (this.boss) {
      this.sparks.burst(this.boss.group.position, C.cyan, 40, 6 * this.scale);
      this.root.remove(this.boss.group);
      this.boss = null;
    }
    for (const e of this.enemies) {
      this.sparks.burst(e.obj.position, C.cyan, 20, 4 * this.scale);
      this.root.remove(e.obj);
    }
    this.enemies = [];
    for (const m of this.mines) if (m.alive) this.killMine(m);
    this.sfx.over();
    this.cb.onEnd(stats);
  }

  private clearField(): void {
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i);
    for (const e of this.enemies) this.root.remove(e.obj);
    this.enemies = [];
    for (const b of this.bolts) this.killBolt(b);
    for (const m of this.mines) this.killMine(m);
    if (this.boss) this.root.remove(this.boss.group);
    this.boss = null;
    this.sparks.clear();
  }

  // ---------------- effetti, interfaccia, spettatore ----------------

  private updateEffects(dt: number): void {
    this.shieldBubble.visible = this.hasPower("shield");
    this.shieldBubble.position.copy(this.head);
    this.shieldBubble.rotation.y += dt * 0.6;
    this.hurtBubble.position.copy(this.head);
    if (this.hurtT > 0) this.hurtT -= dt;
    (this.hurtBubble.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.hurtT) * 0.9;
  }

  /** Il danno appena subito (0..1), per il lampo rosso sullo schermo del PC. */
  get hurt(): number {
    return Math.max(0, this.hurtT) * 2;
  }

  get bossActive(): boolean {
    return this.boss !== null;
  }

  private showToast(text: string): void {
    this.toast = text;
    this.toastT = 1.8;
  }

  view(): ViewModel {
    return {
      phase: this.phase,
      player: this.player,
      nextPlayer: this.nextPlayer,
      score: this.score,
      lives: this.lives,
      combo: R.comboLevel(this.streak),
      wave: this.wave,
      countdown: Math.ceil(this.countdown / (COUNTDOWN / 3)),
      powers: this.powers.map((p) => ({ ...p })),
      toast: this.toast,
      boss: this.boss ? { hp: this.boss.hp, max: this.boss.max } : null,
      result: this.result,
      lockout: this.phase === "over" ? Math.max(0, OVER_LOCK - this.overT) : 0,
      online: this.online,
    };
  }

  /** Converte una posizione del mondo nel riferimento della partita (destra, su, avanti). */
  private local(p: THREE.Vector3): [number, number, number] {
    const d = v2.copy(p).sub(this.anchor);
    const k = 1 / this.scale;
    const r2 = (n: number) => Math.round(n * k * 100) / 100;
    return [r2(d.dot(this.right)), r2(d.y), r2(d.dot(this.forward))];
  }

  /** Fotogramma compatto per il monitor spettatore. */
  frame(): GameFrame {
    const ents: FrameEntity[] = [];
    const push = (id: number, kind: EntityKind, p: THREE.Vector3, rot: number) => {
      const [x, y, z] = this.local(p);
      ents.push([id, kind, x, y, z, Math.round(rot * 100) / 100]);
    };
    for (const r of this.rocks) push(r.id, ENT[r.kind], r.obj.position, r.obj.rotation.x);
    for (const e of this.enemies) push(e.id, ENT.enemy, e.obj.position, 0);
    for (const m of this.mines) if (m.alive) push(m.id, ENT.mine, m.mesh.position, 0);
    for (const b of this.bolts) if (b.alive) push(b.id, ENT.bolt, b.mesh.position, 0);
    const [hx, hy, hz] = this.local(this.head);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let boss: GameFrame["boss"] = null;
    if (this.boss) {
      const [x, y, z] = this.local(this.boss.group.position);
      boss = [x, y, z, this.boss.hp, this.boss.max];
    }
    return {
      head: [hx, hy, hz, r2(this.headDir.dot(this.right)), r2(this.headDir.y), r2(this.headDir.dot(this.forward))],
      ents,
      boss,
      score: this.score,
      lives: this.lives,
      combo: R.comboLevel(this.streak),
      wave: this.wave,
    };
  }
}
