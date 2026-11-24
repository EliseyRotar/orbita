import * as THREE from "three";
import type { GameStats } from "../../../shared/protocol.ts";
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
  kind: R.RockKind;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  hp: number;
  radius: number;
  flash: number;
}

interface Bolt {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  alive: boolean;
}

interface Mine {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  alive: boolean;
}

interface Boss {
  group: THREE.Group;
  core: THREE.Mesh;
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
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function makeRockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  // spostamento coerente per vertici coincidenti (niente buchi tra le facce)
  const offsets = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) {
      k = 0.78 + 0.4 * Math.abs(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453 % 1);
      offsets.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Logica di gioco comune a tutte le modalità. Riceve i "puntatori" (mouse,
 * controller, mani) e la posizione della testa; produce un ViewModel per l'interfaccia.
 */
export class Game {
  readonly root = new THREE.Group();
  readonly scale: number;
  private sparks: Sparks;
  private rockGeos: THREE.BufferGeometry[];
  private rockMats: Record<R.RockKind, THREE.MeshLambertMaterial>;
  private boltGeo: THREE.BufferGeometry;
  private boltMat: THREE.MeshBasicMaterial;
  private mineGeo: THREE.BufferGeometry;
  private mineMat: THREE.MeshLambertMaterial;
  private shieldBubble: THREE.Mesh;
  private hurtBubble: THREE.Mesh;

  private rocks: Rock[] = [];
  private bolts: Bolt[] = [];
  private mines: Mine[] = [];
  private boss: Boss | null = null;

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
  private shots = 0;
  private hits = 0;
  private bossesBeaten = 0;
  private startedAt = 0;
  private countdown = 0;
  private overT = 0;
  private fireCd = 0;
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

  constructor(
    readonly mode: Mode,
    private readonly sfx: Sfx,
    private readonly cb: GameCallbacks,
  ) {
    const ar = mode === "ar";
    this.scale = ar ? 0.2 : 1;
    const s = this.scale;

    this.sparks = new Sparks(ar ? 0.03 : 0.18);
    this.root.add(this.sparks.object);

    this.rockGeos = [1, 2, 3, 4, 5].map(makeRockGeometry);
    // in AR il display è additivo: i colori scuri diventano trasparenti, quindi più luce
    const glow = ar ? 0.35 : 0.08;
    const rockMat = (color: number, emissive: number) =>
      new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: 1, flatShading: true });
    this.rockMats = {
      small: rockMat(C.rock, new THREE.Color(C.rock).multiplyScalar(glow).getHex()),
      medium: rockMat(0x9c86b8, new THREE.Color(0x9c86b8).multiplyScalar(glow).getHex()),
      large: rockMat(C.rockDark, new THREE.Color(C.ice).multiplyScalar(glow * 0.8).getHex()),
      gold: rockMat(C.signal, 0x8a5a00),
    };

    this.boltGeo = new THREE.CapsuleGeometry(0.07 * s, 1.1 * s, 2, 6).rotateX(Math.PI / 2);
    this.boltMat = new THREE.MeshBasicMaterial({ color: C.signal });
    this.mineGeo = new THREE.OctahedronGeometry(0.5 * s, 0);
    this.mineMat = new THREE.MeshLambertMaterial({ color: C.coral, emissive: 0x7a1020, flatShading: true });

    this.shieldBubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 * s, 24, 16),
      new THREE.MeshBasicMaterial({ color: C.ice, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }),
    );
    this.shieldBubble.visible = false;
    this.root.add(this.shieldBubble);
    this.hurtBubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.6 * s, 16, 12),
      new THREE.MeshBasicMaterial({ color: C.coral, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    this.hurtBubble.renderOrder = 999;
    this.root.add(this.hurtBubble);
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

  update(dt: number, headPos: THREE.Vector3, aimers: Aimer[]): void {
    this.head.copy(headPos);
    this.sparks.update(dt);
    this.updateEffects(dt);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = "playing";
        this.startedAt = performance.now();
        this.showToast("Ondata 1");
      }
    } else if (this.phase === "over") {
      this.overT += dt;
    }

    if (this.phase === "playing") this.play(dt, aimers);
    else {
      // asteroidi residui continuano a volare via dopo il game over
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

    this.player = this.nextPlayer ?? "Ospite";
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

    // ondate
    this.waveT += dt;
    if (!this.boss && this.waveT >= R.WAVE_SECONDS) this.nextWave();

    // generazione asteroidi
    this.spawnIn -= dt;
    const interval = R.spawnInterval(this.wave) * (this.boss ? 3 : 1);
    if (this.spawnIn <= 0 && this.rocks.length < R.maxRocks(this.wave)) {
      this.spawnRock(R.pickRock(this.wave));
      this.spawnIn = interval * (0.7 + Math.random() * 0.6);
    }

    // sparo
    this.fireCd -= dt;
    for (const a of aimers) {
      if (a.pressed || (a.held && this.fireCd <= 0)) {
        this.fire(a);
        this.fireCd = R.FIRE_INTERVAL;
      }
    }

    this.moveBolts(dt);
    this.moveRocks(dt * slow, true);
    this.updateBoss(dt * slow);
    this.moveMines(dt * slow);

    // combo
    if (this.streak > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.streak = 0;
    }

    // potenziamenti a tempo
    for (const p of this.powers) if (p.total > 0) p.left -= dt;
    this.powers = this.powers.filter((p) => p.total === 0 || p.left > 0);

    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.3;
      this.cb.onTick(this.score, this.lives, R.comboLevel(this.streak), this.wave);
    }
  }

  private nextWave(): void {
    this.wave++;
    this.waveT = 0;
    if (R.isBossWave(this.wave)) {
      this.spawnBoss();
      this.showToast("Boss in arrivo!");
      this.sfx.bossAlarm();
    } else {
      this.showToast(`Ondata ${this.wave}`);
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

  private spawnRock(kind: R.RockKind, at?: THREE.Vector3, size?: number): void {
    const s = this.scale;
    const spec = R.ROCK[kind];
    const desktop = this.mode === "desktop" || this.mode === "mobile";
    const az = (Math.random() * 2 - 1) * (desktop ? 0.62 : 0.95);
    const el = desktop ? -0.12 + Math.random() * 0.42 : -0.1 + Math.random() * 0.55;
    const pos = at
      ? at.clone()
      : this.dirFrom(az, el, new THREE.Vector3()).multiplyScalar(R.SPAWN_DISTANCE * s).add(this.anchor);
    const radius = (size ?? spec.radius) * s;
    const mesh = new THREE.Mesh(this.rockGeos[Math.floor(Math.random() * this.rockGeos.length)], this.rockMats[kind]);
    mesh.position.copy(pos);
    mesh.scale.setScalar(radius);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    // mira verso la testa con un piccolo scarto, così non arrivano tutti nello stesso punto
    const target = v1
      .copy(this.head)
      .addScaledVector(this.right, (Math.random() - 0.5) * 0.9 * s)
      .addScaledVector(UP, (Math.random() - 0.5) * 0.6 * s);
    const vel = target.sub(pos).normalize().multiplyScalar(R.rockSpeed(this.wave) * spec.speed * s);
    if (at) vel.addScaledVector(this.right, (Math.random() - 0.5) * 3 * s);
    this.rocks.push({
      kind,
      mesh,
      vel: vel.clone(),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.2),
      hp: spec.hp,
      radius,
      flash: 0,
    });
    this.root.add(mesh);
  }

  private moveRocks(dt: number, harmful: boolean): void {
    const s = this.scale;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i]!;
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.rotation.x += r.spin.x * dt;
      r.mesh.rotation.y += r.spin.y * dt;
      if (r.flash > 0) {
        r.flash -= dt;
        r.mesh.scale.setScalar(r.radius * (1 + Math.max(0, r.flash) * 1.5));
      }
      const d = r.mesh.position.distanceTo(this.head);
      const passed = v2.copy(r.mesh.position).sub(this.anchor).dot(this.forward) < -3 * s;
      if (harmful && d < R.HIT_RADIUS * s + r.radius * 0.5) {
        this.sparks.burst(r.mesh.position, C.coral, 30, 6 * s);
        this.removeRock(i);
        this.takeDamage();
      } else if (passed || d > 60 * s) {
        this.removeRock(i);
      }
    }
  }

  private removeRock(i: number): void {
    const r = this.rocks[i]!;
    this.root.remove(r.mesh);
    this.rocks.splice(i, 1);
  }

  private fire(a: Aimer): void {
    const s = this.scale;
    const spread = this.hasPower("triple") ? [-0.07, 0, 0.07] : [0];
    for (const ang of spread) {
      const dir = a.dir.clone();
      if (ang !== 0) dir.applyAxisAngle(UP, ang).normalize();
      let bolt = this.bolts.find((b) => !b.alive);
      if (!bolt) {
        bolt = { mesh: new THREE.Mesh(this.boltGeo, this.boltMat), vel: new THREE.Vector3(), life: 0, alive: false };
        this.bolts.push(bolt);
        this.root.add(bolt.mesh);
      }
      bolt.alive = true;
      bolt.mesh.visible = true;
      bolt.life = 1.1;
      bolt.mesh.position.copy(a.origin).addScaledVector(dir, 0.3 * s);
      bolt.mesh.lookAt(v1.copy(bolt.mesh.position).add(dir));
      bolt.vel.copy(dir).multiplyScalar(R.BOLT_SPEED * s);
      this.shots++;
    }
    this.sfx.shoot();
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
    const hitSphere = (c: THREE.Vector3, rad: number) => {
      const t = len2 > 0 ? Math.max(0, Math.min(1, new THREE.Vector3().subVectors(c, p0).dot(seg) / len2)) : 0;
      const cx = p0.x + seg.x * t - c.x;
      const cy = p0.y + seg.y * t - c.y;
      const cz = p0.z + seg.z * t - c.z;
      return cx * cx + cy * cy + cz * cz <= rad * rad;
    };

    for (let i = 0; i < this.mines.length; i++) {
      const m = this.mines[i]!;
      if (m.alive && hitSphere(m.mesh.position, 0.75 * this.scale)) {
        this.sparks.burst(m.mesh.position, C.coral, 18, 5 * this.scale);
        this.killMine(m);
        this.award(15);
        this.sfx.hit();
        return true;
      }
    }
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i]!;
      // un po' di tolleranza: aiuta chi non ha mai giocato in VR
      if (hitSphere(r.mesh.position, r.radius * 1.35)) {
        this.damageRock(i);
        return true;
      }
    }
    if (this.boss && hitSphere(this.boss.core.getWorldPosition(new THREE.Vector3()), 2.4 * this.scale)) {
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
      this.sparks.burst(r.mesh.position, C.ice, 6, 3 * this.scale);
      return;
    }
    const pos = r.mesh.position.clone();
    const color = r.kind === "gold" ? C.signal : C.paper;
    this.sparks.burst(pos, color, r.kind === "large" ? 60 : 30, 7 * this.scale);
    this.sfx.explode(r.kind === "large");
    this.removeRock(i);
    this.kills++;
    this.streak++;
    this.comboT = R.COMBO_WINDOW;
    const lvl = R.comboLevel(this.streak);
    if (lvl > this.maxCombo) this.maxCombo = lvl;
    if (this.streak % 4 === 0 && lvl <= 5 && this.streak <= 16) {
      this.sfx.combo(lvl);
      this.showToast(`Combo x${lvl}`);
      if (lvl === 5) this.cb.onEvent("combo", "combo x5!");
    }
    this.award(R.ROCK[r.kind].points);

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

  private award(base: number): void {
    this.score += R.pointsFor(base, this.streak, this.hasPower("double"));
  }

  private grantPower(): void {
    const options: PowerKind[] = ["triple", "slow", "shield", "double"];
    if (this.lives < R.MAX_LIVES) options.push("life", "life");
    const kind = options[Math.floor(Math.random() * options.length)]!;
    this.sfx.power();
    this.showToast(POWER_LABEL[kind]);
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
      this.sfx.hit();
      this.showToast("Scudo esaurito");
      return;
    }
    this.lives--;
    this.streak = 0;
    this.hurtT = 0.5;
    this.sfx.damage();
    if (this.lives <= 0) this.gameOver();
  }

  // ---------------- boss ----------------

  private spawnBoss(): void {
    const s = this.scale;
    const index = this.bossesBeaten;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.9 * s, 1),
      new THREE.MeshLambertMaterial({ color: C.coral, emissive: 0x80142a, flatShading: true }),
    );
    group.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.4 * s, 0.32 * s, 8, 40),
      new THREE.MeshLambertMaterial({ color: C.ice, emissive: 0x2a4a66, flatShading: true }),
    );
    ring.rotation.x = Math.PI / 2.4;
    group.add(ring);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.35 * s, 1.4 * s, 5),
        new THREE.MeshLambertMaterial({ color: C.signal, emissive: 0x5a3a00, flatShading: true }),
      );
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 3.4 * s, 0, Math.sin(a) * 3.4 * s);
      spike.rotation.z = -Math.PI / 2;
      spike.rotation.y = -a;
      ring.add(spike);
    }
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(4 * s, 0.25 * s),
      new THREE.MeshBasicMaterial({ color: C.signal, side: THREE.DoubleSide }),
    );
    bar.position.y = 4.4 * s;
    group.add(bar);
    group.position.copy(this.dirFrom(0, 0.2, new THREE.Vector3()).multiplyScalar(40 * s).add(this.anchor));
    this.root.add(group);
    const max = R.bossHp(index);
    this.boss = { group, core, hp: max, max, index, t: 0, fireIn: 2.5, flash: 0, bar };
    this.cb.onEvent("boss", "è arrivato il boss!");
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b) return;
    const s = this.scale;
    b.t += dt;
    const dist = Math.max(20, 40 - b.t * 6) * s;
    const az = Math.sin(b.t * 0.45) * 0.55;
    const el = 0.2 + Math.sin(b.t * 0.7) * 0.08;
    b.group.position.copy(this.dirFrom(az, el, v1).multiplyScalar(dist).add(this.anchor));
    b.group.lookAt(this.head);
    (b.group.children[1] as THREE.Mesh).rotation.z += dt * 1.2;
    b.bar.scale.x = Math.max(0.001, b.hp / b.max);
    if (b.flash > 0) {
      b.flash -= dt;
      b.core.scale.setScalar(1 + Math.max(0, b.flash) * 1.2);
    }
    b.fireIn -= dt;
    if (b.fireIn <= 0 && b.t > 3) {
      b.fireIn = R.mineInterval(b.index);
      this.spawnMine(b.group.position);
    }
  }

  private damageBoss(): void {
    const b = this.boss!;
    b.hp--;
    b.flash = 0.06;
    this.sfx.hit();
    this.sparks.burst(b.core.getWorldPosition(v1), C.signal, 5, 4 * this.scale);
    if (b.hp > 0) return;
    const pos = b.group.position.clone();
    this.sparks.burst(pos, C.coral, 120, 14 * this.scale);
    this.sparks.burst(pos, C.signal, 120, 9 * this.scale);
    this.sfx.explode(true);
    this.root.remove(b.group);
    this.boss = null;
    this.bossesBeaten++;
    this.score += R.bossReward(b.index) * (this.hasPower("double") ? 2 : 1);
    for (const m of this.mines) if (m.alive) this.killMine(m);
    this.showToast(`Boss sconfitto! +${R.bossReward(b.index)}`);
    this.cb.onEvent("boss", `ha sconfitto il boss n° ${b.index + 1}`);
    this.nextWave();
  }

  private spawnMine(from: THREE.Vector3): void {
    let m = this.mines.find((x) => !x.alive);
    if (!m) {
      m = { mesh: new THREE.Mesh(this.mineGeo, this.mineMat), vel: new THREE.Vector3(), alive: false };
      this.mines.push(m);
      this.root.add(m.mesh);
    }
    m.alive = true;
    m.mesh.visible = true;
    m.mesh.position.copy(from);
    m.vel.copy(this.head).sub(from).normalize().multiplyScalar(5.5 * this.scale);
  }

  private moveMines(dt: number): void {
    for (const m of this.mines) {
      if (!m.alive) continue;
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.rotation.y += dt * 4;
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
      this.sparks.burst(this.boss.group.position, C.ice, 40, 6 * this.scale);
      this.root.remove(this.boss.group);
      this.boss = null;
    }
    for (const m of this.mines) if (m.alive) this.killMine(m);
    this.sfx.over();
    this.cb.onEnd(stats);
  }

  private clearField(): void {
    for (let i = this.rocks.length - 1; i >= 0; i--) this.removeRock(i);
    for (const b of this.bolts) this.killBolt(b);
    for (const m of this.mines) this.killMine(m);
    if (this.boss) this.root.remove(this.boss.group);
    this.boss = null;
    this.sparks.clear();
  }

  // ---------------- effetti e interfaccia ----------------

  private updateEffects(dt: number): void {
    this.shieldBubble.visible = this.hasPower("shield");
    this.shieldBubble.position.copy(this.head);
    this.hurtBubble.position.copy(this.head);
    if (this.hurtT > 0) this.hurtT -= dt;
    (this.hurtBubble.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.hurtT) * 0.9;
  }

  /** Il danno appena subito (0..1), per il lampo rosso sullo schermo del PC. */
  get hurt(): number {
    return Math.max(0, this.hurtT) * 2;
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
}
