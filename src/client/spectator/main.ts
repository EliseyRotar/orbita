import "../common/tokens.css";
import "./spectator.css";

import * as THREE from "three";
import { ENT, PLATFORM_NAME, type DeviceInfo, type FrameEntity, type Snapshot, type SpectatorFrame } from "../../shared/protocol.ts";
import { esc, duration } from "../common/format.ts";
import { instance, loadModels, loadSky, type ModelName, type Models } from "../common/assets.ts";
import { Link } from "../common/net.ts";
import { C } from "../play/game/palette.ts";
import { ROCK, ENEMY, BOSS_EVERY } from "../play/game/rules.ts";
import { addLights, buildEnvironment, type Environment } from "../play/game/world.ts";
import { THEMES, themeFor } from "../play/game/themes.ts";

/**
 * Monitor spettatore. Ricostruisce in 3D le partite dai fotogrammi che i dispositivi
 * mandano (5 al secondo) e le mostra in due modi:
 * - SINGOLA: una partita a tutto schermo, alle spalle del pilota o in soggettiva,
 *   con la scheda tecnica del dispositivo (HoloLens, Quest, PC, telefono);
 * - GRIGLIA: tutte le partite in corso insieme (fino a 6), una per riquadro.
 * Tasti: G griglia/singola, V cambia inquadratura, A torna in automatico.
 */

const $ = (id: string) => document.getElementById(id)!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
$("stage").appendChild(renderer.domElement);
window.addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));

const [models, sky] = await Promise.all([loadModels(), loadSky().catch(() => null)]);
// il collegamento parte solo ora: i primi messaggi del server non devono andare persi
const link = new Link(() => ({ t: "hello", role: "spectator" }));

// ---------------- una partita ricostruita ----------------

interface Shown {
  obj: THREE.Object3D;
  target: THREE.Vector3;
  last: THREE.Vector3;
  kind: number;
  seen: number;
}

const boltGeo = new THREE.BoxGeometry(0.12, 0.12, 1.6);
const boltMat = new THREE.MeshBasicMaterial({ color: C.cyan });
const mineGeo = new THREE.OctahedronGeometry(0.45, 0);
const mineMat = new THREE.MeshBasicMaterial({ color: C.pink });
const ROCK_OF: Record<number, { model: ModelName; size: number }> = {
  [ENT.small]: { model: "meteorB", size: ROCK.small.radius },
  [ENT.medium]: { model: "meteor", size: ROCK.medium.radius },
  [ENT.large]: { model: "rockLargeA", size: ROCK.large.radius },
  [ENT.gold]: { model: "crystal", size: ROCK.gold.radius },
};
/** Sul monitor gli oggetti lontani sembrano minuscoli: li ingrandiamo un po' (solo estetica). */
const VIEW_BOOST = 1.4;
/** Riferimento della partita → mondo dello spettatore: avanti = -Z, testa a 1.6 m. */
const toWorld = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, 1.6 + y, -z);
const v1 = new THREE.Vector3();

function makeEntity(kind: number, m: Models): THREE.Object3D {
  if (kind === ENT.bolt) return new THREE.Mesh(boltGeo, boltMat);
  if (kind === ENT.mine) return new THREE.Mesh(mineGeo, mineMat);
  if (kind === ENT.enemy) {
    const o = instance(m, (["enemyA", "enemyB", "enemyC"] as const)[Math.floor(Math.random() * 3)]!);
    o.scale.setScalar(ENEMY.radius * VIEW_BOOST);
    return o;
  }
  const r = ROCK_OF[kind] ?? ROCK_OF[ENT.medium]!;
  const o = instance(m, r.model);
  o.scale.setScalar(r.size * VIEW_BOOST);
  o.rotation.set(Math.random() * 6, Math.random() * 6, 0);
  return o;
}

type Shot = "dietro" | "soggettiva";

class View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 900);
  private env: Environment;
  private pilot: THREE.Object3D;
  private gaze: THREE.Line;
  private shown = new Map<number, Shown>();
  private boss: THREE.Group | null = null;
  private bossTarget = new THREE.Vector3();
  private bursts: { mesh: THREE.Points; vel: Float32Array; t: number }[] = [];
  private frameNo = 0;
  private headW = new THREE.Vector3(0, 1.6, 0);
  private lookW = new THREE.Vector3(0, 1.6, -10);
  private lookS = new THREE.Vector3(0, 1.6, -10);
  latest: SpectatorFrame | null = null;
  lastFrameAt = 0;
  /** Fotogrammi ricevuti al secondo (misurati qui): dice se la rete regge. */
  rate = 0;
  private rateN = 0;
  private rateT = performance.now();

  constructor(readonly deviceId: string) {
    this.scene.background = new THREE.Color(C.black);
    addLights(this.scene, false);
    this.env = buildEnvironment(sky, models);
    this.scene.add(this.env.group);
    this.pilot = instance(models, "astronaut");
    this.pilot.scale.setScalar(0.95);
    this.scene.add(this.pilot);
    this.gaze = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -8)]),
      new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.8 }),
    );
    this.scene.add(this.gaze);
  }

  get stale(): boolean {
    return performance.now() - this.lastFrameAt > 3000;
  }

  apply(f: SpectatorFrame): void {
    this.frameNo++;
    this.lastFrameAt = performance.now();
    this.rateN++;
    this.latest = f;
    for (const [id, kind, x, y, z] of f.ents as FrameEntity[]) {
      let s = this.shown.get(id);
      if (!s) {
        const obj = makeEntity(kind, models);
        toWorld(x, y, z, obj.position);
        this.scene.add(obj);
        s = { obj, target: obj.position.clone(), last: obj.position.clone(), kind, seen: this.frameNo };
        this.shown.set(id, s);
      }
      s.last.copy(s.target);
      toWorld(x, y, z, s.target);
      s.seen = this.frameNo;
    }
    for (const [id, s] of this.shown) {
      if (s.seen === this.frameNo) continue;
      if (s.kind !== ENT.bolt) this.burst(s.obj.position, s.kind === ENT.gold ? C.green : s.kind === ENT.enemy ? C.pink : C.yellow);
      this.scene.remove(s.obj);
      this.shown.delete(id);
    }
    const [hx, hy, hz, dx, dy, dz] = f.head;
    this.pilot.position.set(hx, 0.1, -hz);
    this.pilot.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
    toWorld(hx, hy, hz, this.headW);
    this.lookW.set(dx, dy, -dz).normalize().multiplyScalar(10).add(this.headW);
    this.gaze.position.copy(this.headW);
    this.gaze.lookAt(this.lookW);
    this.gaze.rotateY(Math.PI);

    if (f.boss) {
      if (!this.boss) {
        this.boss = new THREE.Group();
        const hull = instance(models, "boss");
        hull.scale.setScalar(4.2);
        hull.rotation.y = Math.PI;
        this.boss.add(hull);
        this.boss.add(new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.14, 6, 48), new THREE.MeshBasicMaterial({ color: C.pink })));
        toWorld(f.boss[0], f.boss[1], f.boss[2], this.boss.position);
        this.scene.add(this.boss);
      }
      toWorld(f.boss[0], f.boss[1], f.boss[2], this.bossTarget);
    } else if (this.boss) {
      this.burst(this.boss.position, C.pink, 120);
      this.scene.remove(this.boss);
      this.boss = null;
    }
  }

  clear(): void {
    for (const s of this.shown.values()) this.scene.remove(s.obj);
    this.shown.clear();
    if (this.boss) this.scene.remove(this.boss);
    this.boss = null;
    this.latest = null;
  }

  private burst(at: THREE.Vector3, color: number, n = 26): void {
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      v1.randomDirection().multiplyScalar(4 + Math.random() * 6);
      vel.set([v1.x, v1.y, v1.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mesh = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.3, transparent: true }));
    this.scene.add(mesh);
    this.bursts.push({ mesh, vel, t: 0 });
  }

  update(dt: number, t: number, shot: Shot, aspect: number): void {
    const now = performance.now();
    if (now - this.rateT > 2000) {
      this.rate = (this.rateN * 1000) / (now - this.rateT);
      this.rateN = 0;
      this.rateT = now;
    }
    const k = 1 - Math.exp(-dt * 8);
    for (const s of this.shown.values()) {
      s.obj.position.lerp(s.target, k);
      if (s.kind === ENT.bolt) s.obj.lookAt(v1.copy(s.obj.position).add(s.target).sub(s.last));
      else if (s.kind === ENT.enemy) {
        s.obj.lookAt(this.pilot.position.x, 1.6, this.pilot.position.z);
        s.obj.rotateY(Math.PI);
      } else s.obj.rotation.x += dt * 0.8;
    }
    if (this.boss) {
      this.boss.position.lerp(this.bossTarget, k);
      this.boss.lookAt(this.pilot.position.x, 1.6, this.pilot.position.z);
      this.boss.children[1]!.rotation.z += dt * 1.5;
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.t += dt;
      const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j++) arr[j]! += b.vel[j]! * dt;
      pos.needsUpdate = true;
      (b.mesh.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.t * 1.6);
      if (b.t > 0.7) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
      }
    }
    // segnale perso a lungo: si svuota la scena invece di lasciare tutto congelato
    if (performance.now() - this.lastFrameAt > 12000 && this.shown.size) this.clear();

    const f = this.latest;
    this.env.backdrop.setTheme(f ? themeFor(f.wave, BOSS_EVERY) : THEMES[0]!);
    this.env.backdrop.update(dt);

    const live = !!f;
    const first = live && shot === "soggettiva";
    this.pilot.visible = live && !first;
    this.gaze.visible = live && !first;
    this.camera.aspect = aspect;
    if (first) {
      // soggettiva: dagli occhi del pilota, con il suo campo visivo (allargato se è stretto come sull'HoloLens)
      this.camera.fov = Math.max(60, Math.min(90, f.fov ?? 70));
      this.camera.position.copy(this.headW);
      this.lookS.lerp(this.lookW, 1 - Math.exp(-dt * 10));
      this.camera.lookAt(this.lookS);
    } else {
      this.camera.fov = 55;
      const radius = live ? 4.2 : 11;
      const ang = live ? Math.sin(t * 0.15) * 0.3 : t * 0.08;
      this.camera.position.set(this.pilot.position.x + Math.sin(ang) * radius, live ? 2.7 : 4.5, this.pilot.position.z + Math.cos(ang) * radius);
      this.camera.lookAt(0, 3.2, -22);
    }
    this.camera.updateProjectionMatrix();
  }
}

// ---------------- stato e messaggi ----------------

type Layout = "singola" | "griglia";
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* niente */
    }
  },
};
const params = new URLSearchParams(location.search);
let layout: Layout = (params.get("vista") ?? store.get("orbita.spec.layout")) === "griglia" ? "griglia" : "singola";
let shot: Shot = store.get("orbita.spec.shot") === "soggettiva" ? "soggettiva" : "dietro";
let snap: Snapshot | null = null;
let following: string | null = null;
let picked: string | null = null;
const views = new Map<string, View>();

function view(id: string): View {
  let v = views.get(id);
  if (!v) {
    v = new View(id);
    views.set(id, v);
  }
  return v;
}

link.onStatus((online) => {
  if (online) link.send({ t: "spectate:grid", on: layout === "griglia" });
  if (online && picked && layout === "singola") link.send({ t: "spectate:select", deviceId: picked });
});

link.on((msg) => {
  if (msg.t === "snapshot") {
    snap = msg.data;
    // la postazione scelta a mano non c'è più: si torna in automatico
    if (picked && !msg.data.devices.some((d) => d.id === picked && d.online)) {
      picked = null;
      link.send({ t: "spectate:select", deviceId: null });
    }
    prune();
    renderUi();
  } else if (msg.t === "following") {
    if (following !== msg.deviceId && following) views.get(following)?.clear();
    following = msg.deviceId;
    renderUi();
  } else if (msg.t === "frame") {
    view(msg.data.deviceId).apply(msg.data);
  }
});

/** Libera le scene delle postazioni che non giocano più (la memoria del PC non è infinita). */
function prune(): void {
  const keep = new Set(liveDevices().map((d) => d.id));
  if (following) keep.add(following);
  for (const [id, v] of views) {
    if (keep.has(id) || !v.stale) continue;
    v.clear();
    views.delete(id);
  }
}

function setLayout(l: Layout): void {
  layout = l;
  store.set("orbita.spec.layout", l);
  link.send({ t: "spectate:grid", on: l === "griglia" });
  renderUi();
}
function setShot(s: Shot): void {
  shot = s;
  store.set("orbita.spec.shot", s);
  renderUi();
}

document.querySelector(".controls")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-layout],[data-shot]");
  if (!b) return;
  if (b.dataset.layout) setLayout(b.dataset.layout as Layout);
  if (b.dataset.shot) setShot(b.dataset.shot as Shot);
});
$("tabs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-id]");
  if (!btn) return;
  picked = picked === btn.dataset.id ? null : btn.dataset.id!;
  link.send({ t: "spectate:select", deviceId: picked });
  if (layout === "griglia") setLayout("singola");
  renderUi();
});
$("grid-labels").addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>("[data-id]");
  if (!card) return;
  picked = card.dataset.id!;
  link.send({ t: "spectate:select", deviceId: picked });
  setLayout("singola");
});
window.addEventListener("keydown", (e) => {
  if (e.key === "g" || e.key === "G") setLayout(layout === "griglia" ? "singola" : "griglia");
  if (e.key === "v" || e.key === "V") setShot(shot === "dietro" ? "soggettiva" : "dietro");
  if (e.key === "a" || e.key === "A") {
    picked = null;
    link.send({ t: "spectate:select", deviceId: null });
    renderUi();
  }
});

// ---------------- interfaccia ----------------

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");
const DEVICE_NAME = { ar: "Microsoft HoloLens 2", vr: "Meta Quest 2", desktop: "PC", mobile: "Telefono" } as const;
const MODE_NAME = { ar: "Realtà mista (AR)", vr: "Realtà virtuale (VR)", desktop: "Schermo", mobile: "Schermo touch" } as const;
const hearts = (n: number) => {
  const k = Math.max(0, Math.min(6, n));
  return `<span class="hearts">${"♥".repeat(k)}<i>${"♥".repeat(Math.max(0, 4 - k))}</i></span>`;
};

function liveDevices(): DeviceInfo[] {
  return (snap?.devices ?? []).filter((d) => d.online && d.live).sort((a, b) => b.live!.score - a.live!.score).slice(0, 6);
}

/** Stato del segnale di una partita: in diretta, in pausa o perso. */
function signal(v: View | undefined, d: DeviceInfo): { cls: string; text: string } {
  if (d.status === "lost" || (v?.latest && v.stale)) return { cls: "lost", text: "SEGNALE PERSO" };
  if (d.status === "paused" || v?.latest?.paused) return { cls: "paused", text: "IN PAUSA" };
  return { cls: "live", text: "● LIVE" };
}

function renderUi(): void {
  document.body.dataset.layout = layout;
  document.querySelectorAll<HTMLElement>("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));
  document.querySelectorAll<HTMLElement>("[data-shot]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.shot === shot)));
  const lives = liveDevices();

  if (layout === "griglia") {
    $("idle").hidden = lives.length > 0;
    $("solo").hidden = true;
    renderGridLabels(lives);
  } else {
    const devs = (snap?.devices ?? []).filter((d) => d.online);
    const cur = devs.find((d) => d.id === following) ?? null;
    const v = cur ? views.get(cur.id) : undefined;
    const live = cur?.live ?? null;
    $("idle").hidden = !!live;
    $("solo").hidden = !live;
    $("grid-labels").innerHTML = "";
    if (cur && live) renderSolo(cur, v);
    renderTabs(devs);
  }
  $("auto-note").textContent =
    layout === "griglia"
      ? "tutte le partite in corso · tocca un riquadro per ingrandirlo · G cambia vista"
      : picked
        ? "scelta manuale · A per tornare in automatico · V cambia inquadratura"
        : "la telecamera segue chi sta facendo più punti · V cambia inquadratura · G griglia";
}

function renderSolo(d: DeviceInfo, v: View | undefined): void {
  const f = v?.latest ?? null;
  const live = d.live!;
  const sig = signal(v, d);
  $("live-tag").textContent = sig.text;
  $("live-tag").dataset.state = sig.cls;
  $("live-player").textContent = live.player.toUpperCase();
  $("live-score").textContent = pad(f?.score ?? live.score);
  $("boss").hidden = !f?.boss;
  if (f?.boss) $("boss-bar").style.transform = `scaleX(${f.boss[3] / f.boss[4]})`;
  const fps = f?.fps;
  const rows: [string, string][] = [
    ["DISPOSITIVO", DEVICE_NAME[d.platform]],
    ["POSTAZIONE", esc(d.label)],
    ["MODALITÀ", MODE_NAME[f?.mode ?? d.platform]],
    ["CAMPO VISIVO", f?.fov ? `${f.fov}° vert.` : "—"],
    ["FOTOGRAMMI", fps ? `<b class="${fps < 45 ? "warn" : ""}">${fps} fps</b>` : "—"],
    ["SEGNALE", v ? `${v.rate.toFixed(1)} agg./s` : "—"],
    ["VITE", hearts(f?.lives ?? live.lives)],
    ["ONDATA", `${f?.wave ?? live.wave}${f?.boss ? " · BOSS" : ""}`],
    ["COMBO", `x${f?.combo ?? live.combo}`],
    ["IN VOLO DA", duration(Date.now() - live.startedAt)],
  ];
  $("spec").innerHTML = rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("");
}

function renderTabs(devs: DeviceInfo[]): void {
  // visori e PC sempre, telefoni solo mentre giocano
  const list = devs.filter((d) => d.platform !== "mobile" || d.live);
  const key = list.map((d) => `${d.id}:${d.label}:${d.live?.player ?? ""}:${d.nextPlayer ?? ""}:${d.status}:${d.id === following}`).join("|");
  if ($("tabs").dataset.key === key) return;
  $("tabs").dataset.key = key;
  $("tabs").innerHTML = list
    .map((d) => {
      const on = d.id === following;
      const who = d.live ? d.live.player.toUpperCase() : d.nextPlayer ? d.nextPlayer.toUpperCase() : "LIBERO";
      return `<button type="button" class="tab ${on ? "on" : ""} ${d.live ? "playing" : ""} p-${d.platform}" data-id="${esc(d.id)}" aria-pressed="${on}">
        <span class="tab-dev">${esc(d.label.toUpperCase())} <small>${PLATFORM_NAME[d.platform]}</small></span>
        <span class="tab-who">${esc(who)}</span>
      </button>`;
    })
    .join("");
}

/** Riquadri della griglia: colonne e righe in base a quante partite ci sono. */
function gridShape(n: number): [cols: number, rows: number] {
  if (n <= 1) return [1, 1];
  if (n === 2) return [2, 1];
  if (n <= 4) return [2, 2];
  return [3, 2];
}
const TOP = 0;

function renderGridLabels(lives: DeviceInfo[]): void {
  const [cols, rows] = gridShape(lives.length);
  $("grid-labels").style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  $("grid-labels").style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  $("grid-labels").innerHTML = lives
    .map((d, i) => {
      const v = views.get(d.id);
      const f = v?.latest;
      const sig = signal(v, d);
      return `<article class="cell s-${sig.cls}" data-id="${esc(d.id)}">
        <header>
          <span class="pos">${i + 1}°</span>
          <span class="who">${esc(d.live!.player.toUpperCase())}</span>
          <span class="pts">${pad(f?.score ?? d.live!.score)}</span>
        </header>
        <footer>
          <span class="dev p-${d.platform}">${PLATFORM_NAME[d.platform]}</span>
          <span>${esc(d.label)}</span>
          <span>ond. ${f?.wave ?? d.live!.wave}${f?.boss ? " · BOSS" : ""}</span>
          ${hearts(f?.lives ?? d.live!.lives)}
          ${f?.fps ? `<span>${f.fps} fps</span>` : ""}
          <span class="sig">${sig.text}</span>
        </footer>
      </article>`;
    })
    .join("") + `<article class="cell free"><p>POSTO LIBERO<br /><small>chiedi un visore allo stand</small></p></article>`.repeat(lives.length ? cols * rows - lives.length : 0);
}

// ---------------- ciclo ----------------

const timer = new THREE.Timer();
const idleView = new View("__idle");
let uiT = 0;

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(0.05, timer.getDelta());
  const t = time / 1000;
  const W = window.innerWidth;
  const H = window.innerHeight;

  // l'interfaccia si aggiorna 4 volte al secondo, non a ogni fotogramma
  uiT += dt;
  if (uiT > 0.25) {
    uiT = 0;
    renderUi();
  }

  const draw = (v: View, x: number, y: number, w: number, h: number, s: Shot) => {
    v.update(dt, t, s, w / h);
    // WebGL conta le righe dal basso
    renderer.setViewport(x, H - y - h, w, h);
    renderer.setScissor(x, H - y - h, w, h);
    renderer.render(v.scene, v.camera);
  };

  if (layout === "griglia") {
    const lives = liveDevices();
    if (!lives.length) {
      draw(idleView, 0, 0, W, H, "dietro");
      return;
    }
    const [cols, rows] = gridShape(lives.length);
    const gap = 4;
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - TOP - gap * (rows - 1)) / rows;
    renderer.setScissor(0, 0, W, H);
    renderer.setClearColor(0x000000);
    renderer.clear();
    lives.forEach((d, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      draw(view(d.id), Math.round(c * (cw + gap)), Math.round(TOP + r * (ch + gap)), Math.round(cw), Math.round(ch), "dietro");
    });
  } else {
    const v = following ? view(following) : idleView;
    draw(v, 0, 0, W, H, shot);
  }
});

renderUi();
