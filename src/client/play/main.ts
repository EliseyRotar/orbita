import "../common/tokens.css";
import "./play.css";

import * as THREE from "three";
import { accuracy, cleanName, type Platform } from "../../shared/protocol.ts";
import { instance, loadModels, loadSky, type Models } from "../common/assets.ts";
import { Link } from "../common/net.ts";
import { Sfx } from "./game/audio.ts";
import { Game } from "./game/Game.ts";
import { C } from "./game/palette.ts";
import { CardPanel, HudPanel } from "./game/panel.ts";
import { OffscreenArrows } from "./game/arrows.ts";
import { POWER_LABEL, type Aimer, type Mode, type ViewModel } from "./game/types.ts";
import { addLights, buildEnvironment } from "./game/world.ts";
import { setupDiagnostics } from "./diag.ts";

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
/** HoloLens 2: Edge su Windows con supporto AR (si scopre dopo, vedi setupXrButtons). */
const isWindows = /Windows/i.test(ua);
let isHoloLens = /HoloLens/i.test(ua);
let basePlatform: Platform = isHoloLens ? "ar" : isTouch ? "mobile" : "desktop";
const params = new URLSearchParams(location.search);

let deviceId = store.get("orbita.deviceId");
if (!deviceId) {
  deviceId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  store.set("orbita.deviceId", deviceId);
}
const guessLabel = () => {
  const suffix = deviceId!.slice(0, 3).toUpperCase();
  if (isQuest) return `Quest ${suffix}`;
  if (isHoloLens) return `HoloLens ${suffix}`;
  if (isTouch) return `Telefono ${suffix}`;
  return `PC ${suffix}`;
};
const savedLabel = store.get("orbita.label");
let label = savedLabel ?? guessLabel();
let platform: Platform = basePlatform;

const link = new Link(() => ({ t: "hello", role: "device", deviceId: deviceId!, label, platform }));

// ---------------- riferimenti DOM ----------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const SHIP_SVG = (color: string) =>
  `<svg viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges"><path d="M3 0h2v2h1v2h2v3H6V6H2v1H0V4h2V2h1z" fill="${color}"/></svg>`;

const ui = {
  loading: $("#loading"),
  loadingText: $("#loading-text"),
  loadingBar: $("#loading-bar"),
  lobby: $("#lobby"),
  over: $("#over"),
  count: $("#countdown"),
  hud: $("#hud"),
  name: $<HTMLInputElement>("#player-name"),
  play: $<HTMLButtonElement>("#btn-play"),
  vr: $<HTMLButtonElement>("#btn-vr"),
  ar: $<HTMLButtonElement>("#btn-ar"),
  again: $<HTMLButtonElement>("#btn-again"),
  mute: $<HTMLButtonElement>("#btn-mute"),
  xrNote: $("#xr-note"),
  status: $("#status"),
  label: $<HTMLInputElement>("#device-label"),
  player: $("#hud-player"),
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
    enemies: $("#res-enemies"),
    acc: $("#res-acc"),
    combo: $("#res-combo"),
  },
};

// ---------------- scena ----------------

const stage = $("#stage");
// contesto WebGL già "compatibile XR" fin dall'inizio, come negli esempi ufficiali WebXR:
// alcuni HoloLens non riescono a convertirlo dopo, a sessione già richiesta
const canvas = document.createElement("canvas");
const glAttrs: WebGLContextAttributes & { xrCompatible: boolean } = {
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
  xrCompatible: true,
};
const context = (canvas.getContext("webgl2", glAttrs) ?? undefined) as WebGL2RenderingContext | undefined;
const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
stage.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 800);
camera.position.set(0, 1.6, 0);

const sfx = new Sfx();
let models!: Models;
let sky: THREE.Texture | null = null;
let scene = new THREE.Scene();
let game: Game | null = null;
let env: THREE.Group | null = null;
let hud: HudPanel | null = null;
let card: CardPanel | null = null;
let arrows: OffscreenArrows | null = null;
const threats: { pos: THREE.Vector3; danger: boolean }[] = [];
let pendingName: string | null = null;
let watched = false;
/** Rotazione del modello della pistola per avere la canna lungo -Z. */
const GUN_YAW = Number(params.get("gunyaw") ?? 0);
const controllers: { obj: THREE.Group; held: boolean; pressed: boolean; ray: THREE.Object3D }[] = [];

function buildScene(mode: Mode): void {
  scene = new THREE.Scene();
  const ar = mode === "ar";
  if (!ar) {
    scene.background = new THREE.Color(C.black);
    env = buildEnvironment(sky, models);
    scene.add(env);
  } else {
    scene.background = null;
    env = null;
  }
  addLights(scene, ar);
  scene.add(camera);

  game = new Game(
    mode,
    sfx,
    {
      onStart: (player) => link.send({ t: "game:start", player }),
      onTick: (score, lives, combo, wave) => link.send({ t: "game:tick", score, lives, combo, wave }),
      onEvent: (kind, text) => link.send({ t: "game:event", kind, text }),
      onEnd: (stats) => link.send({ t: "game:end", stats }),
      onAbort: () => link.send({ t: "game:abort" }),
    },
    models,
  );
  game.online = link.online;
  game.setNextPlayer(pendingName);
  if (mode === "desktop" || mode === "mobile") queueMicrotask(fitView);
  scene.add(game.root);

  controllers.length = 0;
  hud = card = null;
  if (arrows) camera.remove(arrows.group);
  arrows = null;
  if (mode === "vr" || mode === "ar") {
    // frecce ai bordi del campo visivo (HoloLens ~43°×29°, Quest ~90°×90°)
    arrows = ar ? new OffscreenArrows(0.37, 0.25) : new OffscreenArrows(0.75, 0.7);
    camera.add(arrows.group);
    hud = new HudPanel(ar);
    card = new CardPanel(ar);
    scene.add(hud.mesh, card.mesh);
    for (let i = 0; i < 2; i++) {
      const obj = renderer.xr.getController(i);
      const len = ar ? 2 : 6;
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -len)]),
        new THREE.LineBasicMaterial({ color: C.green, transparent: true, opacity: 0.75 }),
      );
      const tip = new THREE.Mesh(
        new THREE.RingGeometry(ar ? 0.008 : 0.03, ar ? 0.014 : 0.05, 4),
        new THREE.MeshBasicMaterial({ color: C.green, side: THREE.DoubleSide }),
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

      // in VR il controller diventa una pistola laser (Kenney Space Kit), allineata al raggio di mira
      if (mode === "vr") {
        const gun = instance(models, "gun");
        gun.scale.setScalar(0.11);
        gun.rotation.y = GUN_YAW;
        gun.position.set(0, -0.04, 0.02);
        obj.add(gun);
      }
    }
  }
}

// ---------------- rete ----------------

link.onStatus((online) => {
  if (game) game.online = online;
  ui.status.dataset.online = String(online);
  ui.status.textContent = online ? `collegato come ${label}` : "server non collegato";
});

link.on((msg) => {
  switch (msg.t) {
    case "assign":
      pendingName = msg.name;
      game?.setNextPlayer(msg.name);
      if (msg.name && document.activeElement !== ui.name) ui.name.value = msg.name;
      break;
    case "stop":
      game?.forceEnd();
      break;
    case "rank":
      game?.setRank(msg.rankToday, msg.rankAll, msg.isRecord);
      break;
    case "watch":
      watched = msg.on;
      break;
  }
});

// fotogrammi per il monitor spettatore, solo quando qualcuno guarda
setInterval(() => {
  if (!watched || !game) return;
  if (game.phase === "playing" || game.phase === "countdown") link.send({ t: "game:frame", frame: game.frame() });
}, 200);

// ---------------- interfaccia DOM (PC / telefono) ----------------

ui.label.value = label;
ui.label.addEventListener("change", () => {
  label = cleanName(ui.label.value) || label;
  ui.label.value = label;
  store.set("orbita.label", label);
  link.send({ t: "device:label", label });
  ui.status.textContent = `collegato come ${label}`;
});

ui.mute.addEventListener("click", () => {
  sfx.toggleMute();
  ui.mute.textContent = sfx.muted ? "audio: no" : "audio: si";
  ui.mute.setAttribute("aria-pressed", String(sfx.muted));
});

function startDesktop(): void {
  if (!game) return;
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
const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");
let livesShown = -1;

function renderDom(vm: ViewModel): void {
  const xr = renderer.xr.isPresenting;
  show(ui.lobby, !xr && vm.phase === "lobby");
  show(ui.count, !xr && vm.phase === "countdown");
  show(ui.over, !xr && vm.phase === "over");
  show(ui.hud, !xr && (vm.phase === "playing" || vm.phase === "countdown"));
  show(ui.crosshair, !xr && !isTouch && vm.phase === "playing");
  document.body.dataset.phase = vm.phase;

  if (vm.phase === "countdown") set(ui.count, String(Math.max(1, vm.countdown)));
  set(ui.player, `1UP ${vm.player.toUpperCase()}`);
  set(ui.score, pad(vm.score));
  set(ui.wave, `ONDATA ${vm.wave}`);
  set(ui.combo, `x${vm.combo}`);
  ui.combo.dataset.hot = String(vm.combo > 1);
  if (livesShown !== vm.lives) {
    livesShown = vm.lives;
    ui.lives.innerHTML = Array.from({ length: 5 }, (_, i) => SHIP_SVG(i < vm.lives ? "#FF3D7F" : "#333")).join("");
    ui.lives.setAttribute("aria-label", `${vm.lives} vite`);
  }
  set(ui.powers, vm.powers.map((p) => (p.total ? `${POWER_LABEL[p.kind]} ${Math.ceil(p.left)}s` : POWER_LABEL[p.kind])).join("   ").toUpperCase());
  set(ui.toast, vm.toast ?? "");
  ui.toast.dataset.on = String(!!vm.toast);
  show(ui.boss, !!vm.boss);
  if (vm.boss) ui.bossBar.style.transform = `scaleX(${vm.boss.hp / vm.boss.max})`;
  ui.hurt.style.opacity = String(Math.min(1, game?.hurt ?? 0));

  if (vm.phase === "lobby" && vm.nextPlayer && document.activeElement !== ui.name && !ui.name.value) {
    ui.name.value = vm.nextPlayer;
  }
  if (vm.phase === "over" && vm.result) {
    const r = vm.result;
    set(ui.res.who, `bel volo, ${r.player}`);
    set(ui.res.score, pad(r.stats.score));
    set(
      ui.res.rank,
      r.isRecord ? "NUOVO RECORD DELLA FIERA!" : r.rankToday ? `${r.rankToday}° POSTO DI OGGI` : link.online ? "SALVATAGGIO..." : "OFFLINE: NON SALVATO",
    );
    ui.res.rank.dataset.record = String(r.isRecord);
    set(ui.res.kills, String(r.stats.kills));
    set(ui.res.enemies, String(r.stats.enemies));
    set(ui.res.acc, `${Math.round(accuracy(r.stats) * 100)}%`);
    set(ui.res.combo, `x${r.stats.maxCombo}`);
    ui.again.disabled = vm.lockout > 0;
    set(ui.again, vm.nextPlayer ? `GIOCA: ${vm.nextPlayer.toUpperCase()}` : "NUOVA PARTITA");
  }
}

// ---------------- input PC / telefono ----------------

const pointer = new THREE.Vector2(0, 0);
const mouseAim: Aimer = { origin: new THREE.Vector3(), dir: new THREE.Vector3(), held: false, pressed: false };
const raycaster = new THREE.Raycaster();

const movePointer = (e: PointerEvent) => {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ui.crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
};
renderer.domElement.addEventListener("pointermove", movePointer);
renderer.domElement.addEventListener("pointerdown", (e) => {
  movePointer(e);
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
  if (e.code === "KeyM") ui.mute.click();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") mouseAim.held = false;
});
/**
 * Inquadratura adatta allo schermo: in verticale (telefono) si allarga il campo visivo
 * e si stringe il cono dove nascono asteroidi e navicelle, così restano sempre visibili.
 */
function fitView(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 82 : 70;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  game?.setViewCone(Math.min(0.62, hHalf * 0.78), -Math.min(0.12, vHalf * 0.35), Math.min(0.3, vHalf * 0.55));
}
window.addEventListener("resize", fitView);

// ---------------- WebXR ----------------

async function setupXrButtons(): Promise<void> {
  if (!window.isSecureContext) {
    ui.xrNote.hidden = false;
    ui.xrNote.textContent = "Per il visore apri l'indirizzo https:// mostrato dal server.";
    return;
  }
  const xr = navigator.xr;
  if (!xr) return;
  const [vr, ar] = await Promise.all([
    xr.isSessionSupported("immersive-vr").catch(() => false),
    xr.isSessionSupported("immersive-ar").catch(() => false),
  ]);
  // l'HoloLens si presenta come schermo "touch" come un telefono: lo riconosciamo
  // perché è Windows e supporta l'AR (i telefoni Android supportano l'AR ma non sono Windows)
  if (ar && isWindows && !isQuest && !isHoloLens) {
    isHoloLens = true;
    basePlatform = "ar";
    if (!renderer.xr.isPresenting) {
      platform = "ar";
      link.send({ t: "device:platform", platform });
    }
    if (!savedLabel) {
      label = guessLabel();
      ui.label.value = label;
      link.send({ t: "device:label", label });
      ui.status.textContent = `collegato come ${label}`;
    }
  }
  // sui telefoni si gioca a schermo: niente pulsanti AR/VR del telefono, confondono
  const phone = isTouch && !isHoloLens;
  ui.vr.hidden = !vr || phone;
  ui.ar.hidden = !ar || phone;
  xrSupport = { vr, ar };
  seeThrough = isHoloLens;
  // sul Quest la VR è l'esperienza principale, sull'HoloLens l'AR
  const primary = vr && (isQuest || !ar) ? ui.vr : ar ? ui.ar : null;
  if (primary) {
    primary.classList.add("primary");
    ui.play.classList.remove("primary");
    primary.parentElement!.prepend(primary);
  }
}

let xrBusy = false;
/** Visore "trasparente" (HoloLens): supporta l'AR e non è un Quest. */
let seeThrough = false;
let xrSupport = { vr: false, ar: false };

function xrError(kind: string, err: unknown): void {
  const e = err as Error;
  ui.xrNote.hidden = false;
  ui.xrNote.textContent =
    `Impossibile avviare la ${kind.toUpperCase()} (${e?.name ?? "errore"}: ${e?.message ?? err}). ` +
    "Se si ripete: chiudi tutte le finestre di Edge, riaprilo e riprova.";
}

async function enterXr(kind: "vr" | "ar"): Promise<void> {
  // il pizzico dell'HoloLens a volte vale doppio: una sola richiesta alla volta
  if (xrBusy || renderer.xr.isPresenting) return;
  xrBusy = true;
  ui.vr.disabled = ui.ar.disabled = true;
  ui.xrNote.hidden = true;
  sfx.unlock();
  let session: XRSession | null = null;
  try {
    // requestSession va chiamato subito, finché vale il "gesto" dell'utente
    // HoloLens: nessuna opzione extra, esattamente come l'esempio ufficiale che funziona.
    // Chiedere "hand-tracking" o "local-floor" lì può bloccare la richiesta per sempre.
    const init: XRSessionInit | undefined = seeThrough || kind === "ar" ? undefined : { optionalFeatures: ["local-floor", "bounded-floor"] };
    const request = navigator.xr!.requestSession(kind === "vr" ? "immersive-vr" : "immersive-ar", init);
    // su alcuni HoloLens la richiesta resta appesa per sempre: dopo 12 s lo diciamo
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      xrBusy = false;
      ui.vr.disabled = ui.ar.disabled = false;
      ui.xrNote.hidden = false;
      ui.xrNote.textContent =
        `Il visore non risponde alla richiesta ${kind.toUpperCase()}. ` +
        (seeThrough && kind === "ar" ? "Prova ENTRA IN VR (sull'HoloLens è trasparente lo stesso). " : "") +
        `Dati: ${navigator.userAgent.match(/Edg\/[\d.]+/)?.[0] ?? "browser ?"}, AR=${xrSupport.ar}, VR=${xrSupport.vr}.`;
    }, 12000);
    session = await request;
    clearTimeout(timer);
    if (timedOut) {
      // arrivata troppo tardi: la chiudiamo per non bloccare i tentativi successivi
      await session.end().catch(() => {});
      return;
    }
    // sull'HoloLens anche la "VR" va disegnata come AR: niente cielo, oggetti a misura di stanza
    const sceneMode: "vr" | "ar" = kind === "vr" && seeThrough ? "ar" : kind;
    // non tutti i visori hanno il pavimento: se manca si usa lo spazio "local"
    const space: XRReferenceSpaceType =
      sceneMode === "vr" && (await session.requestReferenceSpace("local-floor").then(() => true, () => false)) ? "local-floor" : "local";
    const name = cleanName(ui.name.value);
    if (name) pendingName = name;
    platform = seeThrough ? "ar" : kind;
    link.send({ t: "device:platform", platform });
    renderer.xr.setReferenceSpaceType(space);
    renderer.xr.setFoveation(1);
    await document.fonts.ready;
    buildScene(sceneMode);
    session.addEventListener("end", () => {
      if (game && (game.phase === "playing" || game.phase === "countdown")) game.forceEnd();
      platform = basePlatform;
      link.send({ t: "device:platform", platform });
      camera.position.set(0, 1.6, 0);
      camera.rotation.set(0, 0, 0);
      buildScene(isTouch ? "mobile" : "desktop");
    });
    await renderer.xr.setSession(session);
  } catch (err) {
    xrError(kind, err);
    // una sessione rimasta aperta a metà bloccherebbe ogni nuovo tentativo
    if (session) await session.end().catch(() => {});
  } finally {
    xrBusy = false;
    ui.vr.disabled = ui.ar.disabled = false;
  }
}

setupDiagnostics(document.querySelector("#btn-diag")!, document.querySelector("#diag")!);

ui.vr.addEventListener("click", () => void enterXr("vr"));
ui.ar.addEventListener("click", () => void enterXr("ar"));

// Con ?emulate nell'indirizzo si simula un Meta Quest 3 (VR + AR) per provare senza visore.
let emulator: unknown = null;
if (params.has("emulate")) {
  const { XRDevice, metaQuest3 } = await import("iwer");
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  emulator = device;
}

// ---------------- caricamento ----------------

try {
  const [m, s] = await Promise.all([
    loadModels((done, total) => {
      ui.loadingText.textContent = `CARICAMENTO ${done}/${total}`;
      ui.loadingBar.style.width = `${(done / total) * 100}%`;
    }),
    loadSky().catch(() => null),
  ]);
  models = m;
  sky = s;
} catch (err) {
  ui.loadingText.textContent = "Errore nel caricamento dei modelli: ricarica la pagina";
  throw err;
}
await document.fonts.load('20px "Press Start 2P"').catch(() => {});
buildScene(isTouch ? "mobile" : "desktop");
ui.loading.hidden = true;
void setupXrButtons();

// ---------------- ciclo principale ----------------

const timer = new THREE.Timer();
const headPos = new THREE.Vector3();
const headDir = new THREE.Vector3();
const headQuat = new THREE.Quaternion();
let sway = 0;

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(0.05, timer.getDelta());
  const xr = renderer.xr.isPresenting;
  const aimers: Aimer[] = [];
  if (!game) return;

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

  game.update(dt, headPos, headDir, aimers);
  const vm = game.view();
  const playing = vm.phase === "playing" || vm.phase === "countdown";
  sfx.setMusic(playing ? "game" : "lobby", game.bossActive);

  if (arrows) {
    if (xr && vm.phase === "playing") arrows.update(dt, renderer.xr.getCamera(), threats, game.threats(threats));
    else arrows.hide();
  }
  if (hud && card) {
    hud.mesh.visible = vm.phase === "playing";
    card.mesh.visible = vm.phase !== "playing";
    if (vm.phase === "playing") {
      hud.update(vm);
      hud.place(headPos, headQuat, dt);
    } else {
      card.update(vm);
      card.place(headPos, headQuat, dt);
    }
  }
  renderDom(vm);
  renderer.render(scene, camera);
});

// ---------------- debug (solo con ?debug nell'indirizzo) ----------------

if (params.has("debug")) {
  Object.assign(window, { orbita: { game: () => game, camera, THREE, emulator, renderer } });
}
