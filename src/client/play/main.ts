import "../common/tokens.css";
import "./play.css";

import * as THREE from "three";
import { accuracy, cleanName, type Platform } from "../../shared/protocol.ts";
import { Link } from "../common/net.ts";
import { Sfx } from "./game/audio.ts";
import { Game } from "./game/Game.ts";
import { C } from "./game/palette.ts";
import { CardPanel, HudPanel } from "./game/panel.ts";
import { POWER_LABEL, type Aimer, type Mode, type ViewModel } from "./game/types.ts";
import { addLights, buildEnvironment } from "./game/world.ts";

// ---------------- identità della postazione ----------------

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* modalità privata: pazienza */
    }
  },
};

const ua = navigator.userAgent;
const isQuest = /OculusBrowser|Quest/i.test(ua);
const isTouch = matchMedia("(pointer: coarse)").matches && !isQuest;
const basePlatform: Platform = isTouch ? "mobile" : "desktop";

let deviceId = store.get("orbita.deviceId");
if (!deviceId) {
  deviceId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  store.set("orbita.deviceId", deviceId);
}
const guessLabel = () => {
  const suffix = deviceId!.slice(0, 3).toUpperCase();
  if (isQuest) return `Quest ${suffix}`;
  if (/Windows NT 10.*(ARM|HoloLens)|HoloLens/i.test(ua)) return `HoloLens ${suffix}`;
  if (isTouch) return `Telefono ${suffix}`;
  return `PC ${suffix}`;
};
let label = store.get("orbita.label") ?? guessLabel();
let platform: Platform = basePlatform;

const link = new Link(() => ({ t: "hello", role: "device", deviceId: deviceId!, label, platform }));

// ---------------- scena ----------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $("#stage");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
stage.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 400);
camera.position.set(0, 1.6, 0);

const sfx = new Sfx();
let scene!: THREE.Scene;
let game!: Game;
let env: THREE.Group | null = null;
let hud: HudPanel | null = null;
let card: CardPanel | null = null;
const controllers: { obj: THREE.Group; held: boolean; pressed: boolean; ray: THREE.Object3D }[] = [];

function buildScene(mode: Mode): void {
  scene = new THREE.Scene();
  const ar = mode === "ar";
  if (!ar) {
    scene.background = new THREE.Color(C.deep);
    scene.fog = new THREE.Fog(C.deep, 60, 220);
    env = buildEnvironment();
    scene.add(env);
  } else {
    scene.background = null;
    env = null;
  }
  addLights(scene, ar);
  scene.add(camera);

  game = new Game(mode, sfx, {
    onStart: (player) => link.send({ t: "game:start", player }),
    onTick: (score, lives, combo, wave) => link.send({ t: "game:tick", score, lives, combo, wave }),
    onEvent: (kind, text) => link.send({ t: "game:event", kind, text }),
    onEnd: (stats) => link.send({ t: "game:end", stats }),
    onAbort: () => link.send({ t: "game:abort" }),
  });
  game.online = link.online;
  game.setNextPlayer(pendingName);
  scene.add(game.root);

  controllers.length = 0;
  hud = card = null;
  if (mode === "vr" || mode === "ar") {
    hud = new HudPanel(ar);
    card = new CardPanel(ar);
    scene.add(hud.mesh, card.mesh);
    for (let i = 0; i < 2; i++) {
      const obj = renderer.xr.getController(i);
      const len = ar ? 2 : 6;
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -len)]),
        new THREE.LineBasicMaterial({ color: C.signal, transparent: true, opacity: 0.7 }),
      );
      const tip = new THREE.Mesh(
        new THREE.RingGeometry(ar ? 0.008 : 0.03, ar ? 0.014 : 0.05, 24),
        new THREE.MeshBasicMaterial({ color: C.signal, side: THREE.DoubleSide }),
      );
      tip.position.z = -len;
      ray.add(tip);
      ray.visible = false;
      obj.add(ray);
      const entry = { obj, held: false, pressed: false, ray };
      obj.addEventListener("connected", () => (ray.visible = true));
      obj.addEventListener("disconnected", () => {
        ray.visible = false;
        entry.held = false;
      });
      obj.addEventListener("selectstart", () => {
        entry.held = true;
        entry.pressed = true;
        sfx.unlock();
      });
      obj.addEventListener("selectend", () => (entry.held = false));
      scene.add(obj);
      controllers.push(entry);
    }
  }
}

let mode: Mode = isTouch ? "mobile" : "desktop";
let pendingName: string | null = null;
buildScene(mode);

// ---------------- interfaccia DOM (PC / telefono) ----------------

const ui = {
  lobby: $("#lobby"),
  over: $("#over"),
  count: $("#countdown"),
  hud: $("#hud"),
  name: $<HTMLInputElement>("#player-name"),
  play: $<HTMLButtonElement>("#btn-play"),
  vr: $<HTMLButtonElement>("#btn-vr"),
  ar: $<HTMLButtonElement>("#btn-ar"),
  again: $<HTMLButtonElement>("#btn-again"),
  xrNote: $("#xr-note"),
  status: $("#status"),
  label: $<HTMLInputElement>("#device-label"),
  score: $("#hud-score"),
  lives: $("#hud-lives"),
  combo: $("#hud-combo"),
  wave: $("#hud-wave"),
  powers: $("#hud-powers"),
  toast: $("#toast"),
  boss: $("#hud-boss"),
  bossBar: $("#hud-boss-bar"),
  hurt: $("#hurt"),
  crosshair: $("#crosshair"),
  res: {
    who: $("#res-who"),
    score: $("#res-score"),
    rank: $("#res-rank"),
    kills: $("#res-kills"),
    acc: $("#res-acc"),
    combo: $("#res-combo"),
    wave: $("#res-wave"),
  },
};

// ---------------- rete ----------------

link.onStatus((online) => {
  if (game) game.online = online;
  ui.status.dataset.online = String(online);
  ui.status.textContent = online ? `Collegato · ${label}` : "Non collegato al server";
});

link.on((msg) => {
  switch (msg.t) {
    case "assign":
      pendingName = msg.name;
      game.setNextPlayer(msg.name);
      if (msg.name && document.activeElement !== ui.name) ui.name.value = msg.name;
      break;
    case "stop":
      game.forceEnd();
      break;
    case "rank":
      game.setRank(msg.rankToday, msg.rankAll, msg.isRecord);
      break;
  }
});

ui.label.value = label;
ui.label.addEventListener("change", () => {
  label = cleanName(ui.label.value) || label;
  ui.label.value = label;
  store.set("orbita.label", label);
  link.send({ t: "device:label", label });
  ui.status.textContent = `Collegato · ${label}`;
});

function startDesktop(): void {
  sfx.unlock();
  const name = cleanName(ui.name.value);
  if (name) game.setNextPlayer(name);
  ui.name.value = "";
  pendingName = null;
  const dir = camera.getWorldDirection(new THREE.Vector3());
  game.press(camera.getWorldPosition(new THREE.Vector3()), dir);
}

ui.play.addEventListener("click", startDesktop);
ui.again.addEventListener("click", startDesktop);
ui.name.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startDesktop();
});

const set = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
const show = (el: HTMLElement, on: boolean) => {
  if (el.hidden === on) el.hidden = !on;
};

function renderDom(vm: ViewModel): void {
  const xr = renderer.xr.isPresenting;
  show(ui.lobby, !xr && vm.phase === "lobby");
  show(ui.count, !xr && vm.phase === "countdown");
  show(ui.over, !xr && vm.phase === "over");
  show(ui.hud, !xr && (vm.phase === "playing" || vm.phase === "countdown"));
  show(ui.crosshair, !xr && !isTouch && vm.phase === "playing");
  document.body.dataset.phase = vm.phase;

  if (vm.phase === "countdown") set(ui.count, String(Math.max(1, vm.countdown)));
  set(ui.score, String(vm.score));
  set(ui.wave, `Ondata ${vm.wave}`);
  set(ui.combo, `x${vm.combo}`);
  ui.combo.dataset.hot = String(vm.combo > 1);
  set(ui.lives, "▲".repeat(Math.max(0, vm.lives)) + "△".repeat(Math.max(0, 5 - vm.lives)));
  set(ui.powers, vm.powers.map((p) => (p.total ? `${POWER_LABEL[p.kind]} ${Math.ceil(p.left)}s` : POWER_LABEL[p.kind])).join("   "));
  set(ui.toast, vm.toast ?? "");
  ui.toast.dataset.on = String(!!vm.toast);
  show(ui.boss, !!vm.boss);
  if (vm.boss) ui.bossBar.style.transform = `scaleX(${vm.boss.hp / vm.boss.max})`;
  ui.hurt.style.opacity = String(Math.min(1, game.hurt));

  if (vm.phase === "lobby" && vm.nextPlayer && document.activeElement !== ui.name && !ui.name.value) {
    ui.name.value = vm.nextPlayer;
  }
  if (vm.phase === "over" && vm.result) {
    const r = vm.result;
    set(ui.res.who, `Bel volo, ${r.player}`);
    set(ui.res.score, String(r.stats.score));
    set(
      ui.res.rank,
      r.isRecord ? "Nuovo record della fiera!" : r.rankToday ? `${r.rankToday}° posto nella classifica di oggi` : link.online ? "Salvataggio in classifica…" : "Offline: punteggio non salvato",
    );
    ui.res.rank.dataset.record = String(r.isRecord);
    set(ui.res.kills, String(r.stats.kills));
    set(ui.res.acc, `${Math.round(accuracy(r.stats) * 100)}%`);
    set(ui.res.combo, `x${r.stats.maxCombo}`);
    set(ui.res.wave, String(r.stats.wave));
    ui.again.disabled = vm.lockout > 0;
    set(ui.again, vm.nextPlayer ? `Gioca: ${vm.nextPlayer}` : "Nuova partita");
  }
}

// ---------------- input PC / telefono ----------------

const pointer = new THREE.Vector2(0, 0);
const mouseAim: Aimer = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), held: false, pressed: false };
const raycaster = new THREE.Raycaster();

renderer.domElement.addEventListener("pointermove", (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ui.crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ui.crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  sfx.unlock();
  mouseAim.held = true;
  mouseAim.pressed = true;
});
window.addEventListener("pointerup", () => (mouseAim.held = false));
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!mouseAim.held) mouseAim.pressed = true;
    mouseAim.held = true;
  }
  if (e.code === "KeyM") sfx.muted = !sfx.muted;
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") mouseAim.held = false;
});
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------- WebXR ----------------

async function setupXrButtons(): Promise<void> {
  if (!window.isSecureContext) {
    ui.xrNote.hidden = false;
    ui.xrNote.textContent = "Per giocare con il visore apri l'indirizzo https:// mostrato dal server.";
    return;
  }
  const xr = navigator.xr;
  if (!xr) return;
  const [vr, ar] = await Promise.all([
    xr.isSessionSupported("immersive-vr").catch(() => false),
    xr.isSessionSupported("immersive-ar").catch(() => false),
  ]);
  ui.vr.hidden = !vr;
  ui.ar.hidden = !ar;
  // sul Quest la VR è l'esperienza principale; sull'HoloLens l'AR
  if (vr && ar && isQuest) ui.vr.classList.add("primary");
  else if (ar) ui.ar.classList.add("primary");
  else if (vr) ui.vr.classList.add("primary");
}

async function enterXr(kind: "vr" | "ar"): Promise<void> {
  sfx.unlock();
  await document.fonts.ready;
  const sessionInit: XRSessionInit =
    kind === "vr"
      ? { optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"] }
      : { requiredFeatures: ["local"], optionalFeatures: ["hand-tracking"] };
  let session: XRSession;
  try {
    session = await navigator.xr!.requestSession(kind === "vr" ? "immersive-vr" : "immersive-ar", sessionInit);
  } catch (err) {
    ui.xrNote.hidden = false;
    ui.xrNote.textContent = `Impossibile avviare la sessione ${kind.toUpperCase()}: ${(err as Error).message}`;
    return;
  }
  const name = cleanName(ui.name.value);
  if (name) pendingName = name;
  mode = kind;
  platform = kind;
  link.send({ t: "device:platform", platform });
  renderer.xr.setReferenceSpaceType(kind === "vr" ? "local-floor" : "local");
  renderer.xr.setFoveation(1);
  buildScene(kind);
  await renderer.xr.setSession(session);
  session.addEventListener("end", () => {
    if (game.phase === "playing" || game.phase === "countdown") game.forceEnd();
    mode = basePlatform === "mobile" ? "mobile" : "desktop";
    platform = basePlatform;
    link.send({ t: "device:platform", platform });
    camera.position.set(0, 1.6, 0);
    camera.rotation.set(0, 0, 0);
    buildScene(mode);
  });
}

ui.vr.addEventListener("click", () => void enterXr("vr"));
ui.ar.addEventListener("click", () => void enterXr("ar"));

// Con ?emulate nell'indirizzo si simula un Meta Quest 3 (VR + AR) per provare senza visore.
const params = new URLSearchParams(location.search);
let emulator: unknown = null;
if (params.has("emulate")) {
  const { XRDevice, metaQuest3 } = await import("iwer");
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  emulator = device;
}
void setupXrButtons();

// ---------------- ciclo principale ----------------

const clock = new THREE.Clock();
const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
const headQuat = new THREE.Quaternion();
let sway = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const xr = renderer.xr.isPresenting;
  const aimers: Aimer[] = [];

  if (xr) {
    const xrCam = renderer.xr.getCamera();
    xrCam.getWorldPosition(headPos);
    xrCam.getWorldDirection(headDir);
    xrCam.getWorldQuaternion(headQuat);
    for (const c of controllers) {
      if (!c.ray.visible) {
        c.pressed = false;
        continue;
      }
      const origin = new THREE.Vector3().setFromMatrixPosition(c.obj.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.obj.matrixWorld);
      aimers.push({ origin, dir, held: c.held, pressed: c.pressed });
      if (c.pressed && game.phase !== "playing" && game.phase !== "countdown") game.press(headPos, headDir);
      c.pressed = false;
    }
  } else {
    // leggero movimento della visuale verso il mirino: dà profondità senza nausea
    sway += (pointer.x * 0.12 - sway) * Math.min(1, dt * 4);
    camera.rotation.set(pointer.y * 0.05, -sway, 0);
    camera.getWorldPosition(headPos);
    camera.getWorldDirection(headDir);
    raycaster.setFromCamera(pointer, camera);
    mouseAim.origin.copy(headPos).add(new THREE.Vector3(0, -0.25, 0));
    mouseAim.dir.copy(raycaster.ray.direction).multiplyScalar(40).add(headPos).sub(mouseAim.origin).normalize();
    aimers.push({ ...mouseAim, origin: mouseAim.origin.clone(), dir: mouseAim.dir.clone() });
    mouseAim.pressed = false;
  }

  game.update(dt, headPos, aimers);
  const vm = game.view();

  if (hud && card) {
    const playing = vm.phase === "playing";
    hud.mesh.visible = playing;
    card.mesh.visible = !playing;
    if (playing) {
      hud.update(vm);
      hud.place(headPos, headQuat, dt);
    } else {
      card.update(vm);
      card.place(headPos, headQuat, dt);
    }
  }
  if (env) env.rotation.y += dt * 0.004;
  renderDom(vm);
  renderer.render(scene, camera);
});

// ---------------- debug (solo con ?debug nell'indirizzo) ----------------

if (new URLSearchParams(location.search).has("debug")) {
  Object.assign(window, { orbita: { game: () => game, camera, THREE, emulator, renderer } });
}
