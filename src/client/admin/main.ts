import "../common/tokens.css";
import "./admin.css";

import {
  accuracy,
  DIFFICULTY_PRESETS,
  PLATFORM_NAME,
  type AdminMsg,
  type Difficulty,
  type DeviceInfo,
  type GameRecord,
  type Settings,
  type Snapshot,
  type VisualStyle,
} from "../../shared/protocol.ts";
import { clock, duration, esc, fmt } from "../common/format.ts";
import { Link } from "../common/net.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let pin = sessionStorage.getItem("orbita.pin") ?? "";
const link = new Link(() => ({ t: "hello", role: "admin", pin }));
const send = (m: AdminMsg) => link.send(m);
let snap: Snapshot | null = null;
/** Differenza tra l'orologio del server e il nostro (per "visto 5 s fa"). */
let skew = 0;

link.onStatus((online) => {
  $("conn").dataset.online = String(online);
  $("conn").textContent = online ? "Server collegato" : "Server non raggiungibile";
});

link.on((msg) => {
  if (msg.t === "denied") {
    $("pin-form").hidden = false;
    $("app").hidden = true;
    $("pin-error").textContent = pin || msg.reason.includes("configurato") ? msg.reason : "";
  } else if (msg.t === "welcome") {
    $("pin-form").hidden = true;
    $("app").hidden = false;
  } else if (msg.t === "snapshot") {
    snap = msg.data;
    skew = msg.data.now - Date.now();
    render();
  }
});

$("pin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  pin = $<HTMLInputElement>("pin").value;
  sessionStorage.setItem("orbita.pin", pin);
  link.rehello();
});

let toastTimer = 0;
function toast(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.dataset.on = "true";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.dataset.on = "false"), 2200);
}

// ---------- schede ----------

const TABS = ["devices", "board", "settings", "tools"] as const;
type Tab = (typeof TABS)[number];
function openTab(tab: Tab): void {
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    document.querySelector(`[data-tab="${t}"]`)!.setAttribute("aria-selected", String(t === tab));
  }
  try {
    localStorage.setItem("orbita.adminTab", tab);
  } catch {
    /* niente */
  }
  render();
}
document.querySelector(".tabs")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
  if (b) openTab(b.dataset.tab as Tab);
});
try {
  const saved = localStorage.getItem("orbita.adminTab") as Tab | null;
  if (saved && TABS.includes(saved)) openTab(saved);
} catch {
  /* niente */
}

// ---------- postazioni ----------

const STATUS: Record<DeviceInfo["status"], string> = {
  idle: "Libera",
  ready: "Pronta",
  playing: "In partita",
  paused: "In pausa",
  lost: "Segnale perso",
  over: "Partita finita",
};

/** Non ridisegnare un campo mentre l'operatore ci sta scrivendo. */
function isEditing(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement && !!a.closest("#devices");
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() + skew - at) / 1000));
  if (s < 5) return "adesso";
  if (s < 60) return `${s} s fa`;
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  return `${Math.floor(s / 3600)} h fa`;
}

const hearts = (n: number) => `<span class="hearts" aria-label="${n} vite">${"♥".repeat(Math.max(0, n))}<i>${"♥".repeat(Math.max(0, 4 - n))}</i></span>`;

function deviceCard(d: DeviceInfo, s: Snapshot): string {
  const state = d.online ? d.status : "offline";
  const live = d.live
    ? `<div class="live">
        <div><small>PILOTA</small><b>${esc(d.live.player)}</b></div>
        <div><small>PUNTI</small><b class="score">${fmt(d.live.score)}</b></div>
        <div><small>VITE</small>${hearts(d.live.lives)}</div>
        <div><small>ONDATA</small><b>${d.live.wave}</b></div>
        <div><small>DURATA</small><b>${duration(Date.now() + skew - d.live.startedAt)}</b></div>
      </div>`
    : d.nextPlayer
      ? `<p class="next">Prossimo pilota: <b>${esc(d.nextPlayer)}</b></p>`
      : "";
  return `<article class="device st-${state}" data-id="${esc(d.id)}">
    <header>
      <input class="label" value="${esc(d.label)}" aria-label="Nome postazione" maxlength="18" />
      <span class="tag p-${d.platform}">${PLATFORM_NAME[d.platform]}</span>
    </header>
    <p class="state"><span class="dot"></span>${d.online ? STATUS[d.status] : "Scollegata"}<span class="seen">visto ${ago(d.lastSeen)}</span></p>
    ${live}
    ${
      d.platform === "mobile"
        ? ""
        : `<form class="assign inline">
      <input name="name" maxlength="18" placeholder="Nome del prossimo pilota" autocomplete="off" />
      <button class="btn primary">Assegna</button>
      <button type="button" class="btn" data-act="next" ${s.queue.length ? "" : "disabled"} title="${s.queue.length ? esc(s.queue[0]!) : "coda vuota"}">Primo in coda</button>
    </form>`
    }
    <div class="tools">
      ${d.nextPlayer ? `<button type="button" class="link" data-act="unassign">Togli nome</button>` : ""}
      ${d.live ? `<button type="button" class="link danger" data-act="stop">Termina partita</button>` : ""}
      ${d.status !== "idle" && d.status !== "ready" ? `<button type="button" class="link" data-act="reset" title="Se risulta ancora in partita ma non lo è">Azzera stato</button>` : ""}
      ${d.online ? "" : `<button type="button" class="link" data-act="forget">Rimuovi</button>`}
    </div>
  </article>`;
}

function renderDevices(s: Snapshot): void {
  if (isEditing()) return;
  // prima i visori e i PC, poi i telefoni dei visitatori
  const fixed = s.devices.filter((d) => d.platform !== "mobile");
  const phones = s.devices.filter((d) => d.platform === "mobile");
  $("devices").innerHTML =
    (fixed.length
      ? fixed.map((d) => deviceCard(d, s)).join("")
      : `<p class="empty">Nessuna postazione. Apri il gioco su un visore o un PC.</p>`) +
    (phones.length ? `<h3 class="sub">Telefoni</h3>${phones.map((d) => deviceCard(d, s)).join("")}` : "");
  const live = s.devices.filter((d) => d.live).length;
  $("tab-live").textContent = live ? `${live} in volo` : "";
}

$("devices").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const id = form.closest<HTMLElement>(".device")!.dataset.id!;
  const input = form.elements.namedItem("name") as HTMLInputElement;
  if (!input.value.trim()) return;
  send({ t: "admin:assign", deviceId: id, name: input.value });
  toast(`Assegnato: ${input.value.trim()}`);
  input.value = "";
  input.blur();
});

$("devices").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-act]");
  if (!btn) return;
  const id = btn.closest<HTMLElement>(".device")!.dataset.id!;
  const act = btn.dataset.act;
  if (act === "next") send({ t: "admin:queue:next", deviceId: id });
  if (act === "unassign") send({ t: "admin:unassign", deviceId: id });
  if (act === "stop" && confirm("Terminare la partita? Il punteggio viene salvato.")) send({ t: "admin:stop", deviceId: id });
  if (act === "reset") {
    send({ t: "admin:reset", deviceId: id });
    toast("Stato azzerato");
  }
  if (act === "forget") send({ t: "admin:forget", deviceId: id });
});

$("devices").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.classList.contains("label")) return;
  const id = input.closest<HTMLElement>(".device")!.dataset.id!;
  send({ t: "admin:rename", deviceId: id, label: input.value });
});

$("devices").addEventListener("focusout", () => setTimeout(() => snap && !isEditing() && renderDevices(snap), 0));

// ---------- coda ----------

$("queue-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("queue-name");
  if (input.value.trim()) send({ t: "admin:queue:add", name: input.value });
  input.value = "";
});

$("queue").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-index]");
  if (btn) send({ t: "admin:queue:remove", index: Number(btn.dataset.index) });
});

// ---------- classifica ----------

type Board = "today" | "recent" | "all";
let board: Board = "today";
document.querySelector(".seg")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-board]");
  if (!b) return;
  board = b.dataset.board as Board;
  document.querySelectorAll("[data-board]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
});
$("board-filter").addEventListener("input", () => render());

function boardRows(s: Snapshot): GameRecord[] {
  const list = board === "today" ? s.bestToday : board === "recent" ? s.recent : s.leaderboardAll;
  const q = $<HTMLInputElement>("board-filter").value.trim().toLowerCase();
  return q ? list.filter((g) => g.player.toLowerCase().includes(q)) : list;
}

function renderBoard(s: Snapshot): void {
  const rows = boardRows(s);
  $("games").innerHTML = rows.length
    ? rows
        .map(
          (g, i) => `<tr>
        <td class="pos">${board === "recent" ? "" : i + 1}</td>
        <td><b>${esc(g.player)}</b></td>
        <td class="num score">${fmt(g.score)}</td>
        <td><span class="tag p-${g.platform}">${PLATFORM_NAME[g.platform]}</span> <small>${esc(g.deviceLabel)}</small></td>
        <td class="num">${g.wave}</td>
        <td class="num">${Math.round(accuracy(g) * 100)}%</td>
        <td><small>${clock(g.endedAt)} · ${duration(g.durationMs)}</small></td>
        <td class="row-tools">
          <button class="link" data-game="${g.id}" data-act="rename" data-name="${esc(g.player)}">Rinomina</button>
          <button class="link danger" data-game="${g.id}" data-act="delete">Elimina</button>
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="8" class="empty">Nessuna partita.</td></tr>`;
}

$("games").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-game]");
  if (!btn) return;
  const id = btn.dataset.game!;
  if (btn.dataset.act === "delete" && confirm("Eliminare questa partita dalla classifica?")) send({ t: "admin:game:delete", id });
  if (btn.dataset.act === "rename") {
    const name = prompt("Nuovo nome del giocatore:", btn.dataset.name);
    if (name?.trim()) send({ t: "admin:game:rename", id, player: name });
  }
});

$("csv").addEventListener("click", () => {
  if (!snap) return;
  const rows = boardRows(snap);
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    ["giocatore", "punti", "dispositivo", "postazione", "ondata", "precisione", "distrutti", "nemici", "boss", "durata_s", "fine"].join(";"),
    ...rows.map((g) =>
      [q(g.player), g.score, PLATFORM_NAME[g.platform], q(g.deviceLabel), g.wave, Math.round(accuracy(g) * 100), g.kills, g.enemies, g.bosses, Math.round(g.durationMs / 1000), new Date(g.endedAt).toISOString()].join(";"),
    ),
  ].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `orbita-${board}-${snap.today}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- difficoltà e grafica ----------

const PRESET_INFO: Record<keyof typeof DIFFICULTY_PRESETS, string> = {
  facile: "bambini e chi non ha mai giocato",
  normale: "si suda dalla seconda ondata",
  difficile: "per chi torna a riprovare",
  inferno: "solo per i professori",
};
const SLIDERS: { key: Exclude<keyof Difficulty, "preset">; label: string; hint: string }[] = [
  { key: "speed", label: "Velocità", hint: "asteroidi e colpi nemici" },
  { key: "spawn", label: "Quantità", hint: "quanti asteroidi arrivano" },
  { key: "enemies", label: "Nemici", hint: "navicelle e quanto sparano" },
  { key: "bossHp", label: "Vita del boss", hint: "colpi per abbatterlo" },
  { key: "ramp", label: "Crescita", hint: "quanto si fa dura a ogni ondata" },
];
const STYLE_LABEL: Record<VisualStyle, string> = { neon: "Neon arcade", realistico: "Realistico", ologramma: "Ologramma" };
const STYLE_TARGETS: { key: "styleScreen" | "styleVr" | "styleAr"; label: string }[] = [
  { key: "styleScreen", label: "PC e telefoni" },
  { key: "styleVr", label: "Meta Quest (VR)" },
  { key: "styleAr", label: "HoloLens (AR)" },
];
const num2 = (n: number) => n.toFixed(2).replace(".", ",");

function buildSettings(): void {
  $("presets").innerHTML = (Object.keys(DIFFICULTY_PRESETS) as (keyof typeof DIFFICULTY_PRESETS)[])
    .map((p) => `<button type="button" class="preset" data-preset="${p}"><b>${p.toUpperCase()}</b><small>${PRESET_INFO[p]}</small></button>`)
    .join("");
  $("sliders").innerHTML = SLIDERS.map(
    (s) => `<label class="slider">
      <span class="name">${s.label}<small>${s.hint}</small></span>
      <input type="range" min="0.3" max="3" step="0.05" data-key="${s.key}" />
      <output data-out="${s.key}"></output>
    </label>`,
  ).join("");
  $("styles").innerHTML = STYLE_TARGETS.map(
    (t) => `<div class="style-row"><span>${t.label}</span><div class="seg">${(Object.keys(STYLE_LABEL) as VisualStyle[])
      .map((v) => `<button type="button" data-style="${t.key}" data-value="${v}" aria-pressed="false">${STYLE_LABEL[v]}</button>`)
      .join("")}</div></div>`,
  ).join("");
}
buildSettings();

let dragging = false;
function renderSettings(st: Settings): void {
  document.querySelectorAll<HTMLElement>("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === st.difficulty.preset)));
  if (!dragging) {
    for (const s of SLIDERS) {
      document.querySelector<HTMLInputElement>(`[data-key="${s.key}"]`)!.value = String(st.difficulty[s.key]);
      document.querySelector(`[data-out="${s.key}"]`)!.textContent = `×${num2(st.difficulty[s.key])}`;
    }
  }
  document.querySelectorAll<HTMLElement>("[data-style]").forEach((b) =>
    b.setAttribute("aria-pressed", String(st[b.dataset.style as "styleScreen"] === b.dataset.value)),
  );
  $<HTMLInputElement>("phone-name").checked = st.phoneNameRequired;
}

$("presets").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-preset]");
  if (!b) return;
  const d = DIFFICULTY_PRESETS[b.dataset.preset as keyof typeof DIFFICULTY_PRESETS];
  send({ t: "admin:settings", settings: { difficulty: d } });
  toast(`Difficoltà: ${d.preset}`);
});

function sliderDifficulty(): Difficulty {
  const d = { preset: "personalizzata" } as Difficulty;
  for (const s of SLIDERS) d[s.key] = Number(document.querySelector<HTMLInputElement>(`[data-key="${s.key}"]`)!.value);
  return d;
}
$("sliders").addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  dragging = true;
  document.querySelector(`[data-out="${input.dataset.key}"]`)!.textContent = `×${num2(Number(input.value))}`;
});
$("sliders").addEventListener("change", () => {
  dragging = false;
  send({ t: "admin:settings", settings: { difficulty: sliderDifficulty() } });
  toast("Difficoltà personalizzata salvata");
});

$("styles").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-style]");
  if (!b) return;
  send({ t: "admin:settings", settings: { [b.dataset.style!]: b.dataset.value } as Partial<Settings> });
  toast("Stile aggiornato");
});

$("phone-name").addEventListener("change", (e) => {
  send({ t: "admin:settings", settings: { phoneNameRequired: (e.target as HTMLInputElement).checked } });
});

// ---------- strumenti ----------

$("info-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("info-text");
  if (input.value.trim()) {
    send({ t: "admin:feed:info", text: input.value });
    toast("Messaggio pubblicato");
  }
  input.value = "";
});
$("stop-all").addEventListener("click", () => {
  if (confirm("Terminare TUTTE le partite in corso? I punteggi vengono salvati.")) send({ t: "admin:stopAll" });
});
$("reload-all").addEventListener("click", () => {
  if (confirm("Ricaricare il gioco su tutte le postazioni?")) {
    send({ t: "admin:reloadAll" });
    toast("Ricarica inviata");
  }
});

// ---------- disegno ----------

function render(): void {
  if (!snap) return;
  const s = snap;
  const t = s.totalsToday;
  const best = s.bestToday[0];
  $("stats").innerHTML = `
    <div><dt>partite oggi</dt><dd>${fmt(t.games)}</dd></div>
    <div><dt>giocatori</dt><dd>${fmt(s.bestToday.length)}</dd></div>
    <div><dt>record</dt><dd>${best ? `${fmt(best.score)} <small>${esc(best.player)}</small>` : "—"}</dd></div>
    <div><dt>difficoltà</dt><dd>${esc(s.settings.difficulty.preset)}</dd></div>`;
  if (!$("tab-devices").hidden) {
    renderDevices(s);
    $("queue").innerHTML = s.queue.length
      ? s.queue.map((n, i) => `<li><span>${i + 1}. ${esc(n)}</span><button class="link" data-index="${i}" aria-label="Togli ${esc(n)} dalla coda">Togli</button></li>`).join("")
      : `<li class="empty">Coda vuota</li>`;
    $("phones").textContent = s.phones.online
      ? `${s.phones.online} collegati, ${s.phones.playing} in partita. Compaiono anche nella classifica.`
      : "Nessun telefono collegato. I visitatori giocano inquadrando il QR sul monitor.";
    $("feed").innerHTML = s.feed
      .slice(0, 12)
      .map((f) => `<li class="k-${f.kind}"><time>${clock(f.at)}</time> ${esc(f.text)}</li>`)
      .join("");
  } else {
    const live = s.devices.filter((d) => d.live).length;
    $("tab-live").textContent = live ? `${live} in volo` : "";
  }
  if (!$("tab-board").hidden) renderBoard(s);
  if (!$("tab-settings").hidden) renderSettings(s.settings);
  $("play-url").textContent = s.config.playUrl || `${location.origin}/`;
}

// "visto X s fa" e durata si aggiornano anche senza nuovi messaggi
setInterval(() => snap && !$("tab-devices").hidden && renderDevices(snap), 5000);
