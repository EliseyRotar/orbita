import "../common/tokens.css";
import "./spectator.css";

import * as THREE from "three";
import { ENT, PLATFORM_NAME, type DeviceInfo, type FrameEntity, type Snapshot, type SpectatorFrame } from "../../shared/protocol.ts";
import { esc } from "../common/format.ts";
import { instance, loadModels, loadSky, type ModelName, type Models } from "../common/assets.ts";
import { Link } from "../common/net.ts";
import { C } from "../play/game/palette.ts";
import { ROCK, ENEMY } from "../play/game/rules.ts";
import { addLights, buildEnvironment } from "../play/game/world.ts";

/**
 * Monitor spettatore: ricostruisce in 3D la partita di un visore a partire dai
 * fotogrammi che il visore manda (10 al secondo) e la mostra da dietro il giocatore.
 */

const $ = (id: string) => document.getElementById(id)!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
$("stage").appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.black);
addLights(scene, false);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const [models, sky] = await Promise.all([loadModels(), loadSky().catch(() => null)]);
// il collegamento parte solo ora: se partisse prima, i primi messaggi del server
// (elenco postazioni, partita da seguire) arriverebbero mentre nessuno li ascolta
const link = new Link(() => ({ t: "hello", role: "spectator" }));
scene.add(buildEnvironment(sky, models));

// giocatore: astronauta sulla piattaforma con il "raggio" dello sguardo
const pilot = instance(models, "astronaut");
pilot.scale.setScalar(0.95);
scene.add(pilot);
const gaze = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -8)]),
  new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.8 }),
);
scene.add(gaze);

// ---------------- entità ----------------

interface Shown {
  obj: THREE.Object3D;
  target: THREE.Vector3;
  last: THREE.Vector3;
  kind: number;
  seen: number;
}

const shown = new Map<number, Shown>();
const boltGeo = new THREE.BoxGeometry(0.12, 0.12, 1.6);
const boltMat = new THREE.MeshBasicMaterial({ color: C.cyan });
const mineGeo = new THREE.OctahedronGeometry(0.45, 0);
const mineMat = new THREE.MeshBasicMaterial({ color: C.pink });
const ROCK_OF: Record<number, { model: ModelName; size: number }> = {
  [ENT.small]: { model: "meteorB", size: ROCK.small.radius },
  [ENT.medium]: { model: "meteor", size: ROCK.medium.radius },
  [ENT.large]: { model: "meteor", size: ROCK.large.radius },
  [ENT.gold]: { model: "crystal", size: ROCK.gold.radius },
};

/** Sul monitor gli oggetti lontani sembrano minuscoli: li ingrandiamo un po' (solo estetica). */
const VIEW_BOOST = 1.4;

/** Riferimento della partita → mondo dello spettatore: avanti = -Z, testa a 1.6 m. */
const toWorld = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, 1.6 + y, -z);

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

let bossObj: THREE.Group | null = null;
let bossTarget = new THREE.Vector3();
let frameNo = 0;
let lastFrameAt = 0;
let latest: SpectatorFrame | null = null;

function applyFrame(f: SpectatorFrame): void {
  frameNo++;
  lastFrameAt = performance.now();
  latest = f;
  for (const e of f.ents as FrameEntity[]) {
    const [id, kind, x, y, z] = e;
    let s = shown.get(id);
    if (!s) {
      const obj = makeEntity(kind, models);
      toWorld(x, y, z, obj.position);
      scene.add(obj);
      s = { obj, target: obj.position.clone(), last: obj.position.clone(), kind, seen: frameNo };
      shown.set(id, s);
    }
    s.last.copy(s.target);
    toWorld(x, y, z, s.target);
    s.seen = frameNo;
  }
  for (const [id, s] of shown) {
    if (s.seen !== frameNo) {
      if (s.kind !== ENT.bolt) burst(s.obj.position, s.kind === ENT.gold ? C.green : C.yellow);
      scene.remove(s.obj);
      shown.delete(id);
    }
  }
  const [hx, hy, hz, dx, dy, dz] = f.head;
  pilot.position.set(hx, 0.1, -hz);
  pilot.rotation.y = Math.atan2(-dx, -dz) + Math.PI;
  const headW = toWorld(hx, hy, hz);
  gaze.position.copy(headW);
  gaze.lookAt(headW.clone().add(new THREE.Vector3(dx, dy, -dz)));
  gaze.rotateY(Math.PI);

  if (f.boss) {
    if (!bossObj) {
      bossObj = new THREE.Group();
      const hull = instance(models, "boss");
      hull.scale.setScalar(4.2);
      hull.rotation.y = Math.PI;
      bossObj.add(hull);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.14, 6, 48), new THREE.MeshBasicMaterial({ color: C.pink }));
      bossObj.add(ring);
      toWorld(f.boss[0], f.boss[1], f.boss[2], bossObj.position);
      scene.add(bossObj);
    }
    toWorld(f.boss[0], f.boss[1], f.boss[2], bossTarget);
  } else if (bossObj) {
    burst(bossObj.position, C.pink, 120);
    scene.remove(bossObj);
    bossObj = null;
  }
}

function clearAll(): void {
  for (const s of shown.values()) scene.remove(s.obj);
  shown.clear();
  if (bossObj) scene.remove(bossObj);
  bossObj = null;
  latest = null;
}

// esplosioni semplici (quadrati che si allargano), solo estetiche
const bursts: { mesh: THREE.Points; t: number }[] = [];
function burst(at: THREE.Vector3, color: number, n = 26): void {
  const pos = new Float32Array(n * 3);
  const vel: number[] = [];
  for (let i = 0; i < n; i++) {
    pos.set([at.x, at.y, at.z], i * 3);
    const v = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 6);
    vel.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.userData.vel = vel;
  const mesh = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.3, transparent: true }));
  scene.add(mesh);
  bursts.push({ mesh, t: 0 });
}

// ---------------- interfaccia ----------------

let snap: Snapshot | null = null;
let following: string | null = null;
let picked: string | null = null;

link.on((msg) => {
  if (msg.t === "snapshot") {
    snap = msg.data;
    renderUi();
  } else if (msg.t === "following") {
    following = msg.deviceId;
    clearAll();
    renderUi();
  } else if (msg.t === "frame" && msg.data.deviceId === following) {
    applyFrame(msg.data);
    renderUi();
  }
});

$("tabs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-id]");
  if (!btn) return;
  picked = picked === btn.dataset.id ? null : btn.dataset.id!;
  link.send({ t: "spectate:select", deviceId: picked });
  renderUi();
});

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");

function renderUi(): void {
  const devs: DeviceInfo[] = (snap?.devices ?? []).filter((d) => d.online);
  const cur = devs.find((d) => d.id === following) ?? null;
  const live = cur?.live ?? null;
  $("idle").hidden = !!live;
  $("live-tag").textContent = live ? "● LIVE" : "IN ATTESA";
  $("live-tag").dataset.live = String(!!live);
  $("live-player").textContent = live ? live.player.toUpperCase() : "";
  $("live-meta").textContent = live && cur ? `su ${cur.label.toUpperCase()} · ONDATA ${latest?.wave ?? live.wave}${latest?.boss ? " · BOSS" : ""}` : "";
  $("live-score").textContent = live ? pad(latest?.score ?? live.score) : "";
  $("boss").hidden = !latest?.boss;
  if (latest?.boss) $("boss-bar").style.transform = `scaleX(${latest.boss[3] / latest.boss[4]})`;
  $("auto-note").textContent = picked ? "scelta manuale: tocca di nuovo per tornare in automatico" : "la telecamera segue chi sta facendo più punti";
  $("tabs").innerHTML = devs
    .map((d) => {
      const on = d.id === following;
      const who = d.live ? d.live.player.toUpperCase() : d.nextPlayer ? d.nextPlayer.toUpperCase() : "LIBERO";
      return `<button type="button" class="tab ${on ? "on" : ""} ${d.live ? "playing" : ""}" data-id="${esc(d.id)}" aria-pressed="${on}">
        <span class="tab-dev">${esc(d.label.toUpperCase())} <small>${PLATFORM_NAME[d.platform]}</small></span>
        <span class="tab-who">${esc(who)}</span>
      </button>`;
    })
    .join("");
}

// ---------------- ciclo ----------------

const timer = new THREE.Timer();
const camTarget = new THREE.Vector3(0, 3.2, -22);
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(0.05, timer.getDelta());
  const t = time / 1000;
  const k = 1 - Math.exp(-dt * 8);

  for (const s of shown.values()) {
    s.obj.position.lerp(s.target, k);
    if (s.kind === ENT.bolt) s.obj.lookAt(s.obj.position.clone().add(s.target).sub(s.last));
    else if (s.kind === ENT.enemy) {
      s.obj.lookAt(pilot.position.x, 1.6, pilot.position.z);
      s.obj.rotateY(Math.PI);
    }
    else s.obj.rotation.x += dt * 0.8;
  }
  if (bossObj) {
    bossObj.position.lerp(bossTarget, k);
    bossObj.lookAt(pilot.position.x, 1.6, pilot.position.z);
    (bossObj.children[1] as THREE.Mesh).rotation.z += dt * 1.5;
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i]!;
    b.t += dt;
    const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const vel = b.mesh.geometry.userData.vel as number[];
    for (let j = 0; j < pos.count; j++) pos.setXYZ(j, pos.getX(j) + vel[j * 3]! * dt, pos.getY(j) + vel[j * 3 + 1]! * dt, pos.getZ(j) + vel[j * 3 + 2]! * dt);
    pos.needsUpdate = true;
    (b.mesh.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.t * 1.6);
    if (b.t > 0.7) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      bursts.splice(i, 1);
    }
  }

  // se i fotogrammi si fermano (hotspot) le entità restano ferme invece di sparire di colpo
  const stale = performance.now() - lastFrameAt > 4000;
  if (stale && shown.size) clearAll();

  // telecamera: alle spalle del pilota, con un lento ondeggiare
  const live = !!latest;
  const radius = live ? 4.2 : 11;
  const ang = live ? Math.sin(t * 0.15) * 0.3 : t * 0.08;
  camera.position.set(pilot.position.x + Math.sin(ang) * radius, live ? 2.7 : 4.5, pilot.position.z + Math.cos(ang) * radius);
  camera.lookAt(camTarget);
  pilot.visible = live;
  gaze.visible = live;
  renderer.render(scene, camera);
});

renderUi();
