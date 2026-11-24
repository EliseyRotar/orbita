import "../common/tokens.css";
import "./tv.css";

import { accuracy, PLATFORM_NAME, type DeviceInfo, type FeedItem, type GameRecord, type Snapshot } from "../../shared/protocol.ts";
import { esc, fmt, minutes } from "../common/format.ts";
import { Link } from "../common/net.ts";

const $ = (id: string) => document.getElementById(id)!;
const link = new Link(() => ({ t: "hello", role: "tv" }));

let lastSnap: Snapshot | null = null;
let seenFeed = new Set<string>();
let firstSnapshot = true;

link.onStatus((online) => ($("offline").hidden = online));

function fit(): void {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  document.documentElement.style.setProperty("--fit", String(s));
}
window.addEventListener("resize", fit);
fit();

link.on((msg) => {
  if (msg.t !== "snapshot") return;
  render(msg.data);
  detectRecords(msg.data.feed);
  lastSnap = msg.data;
});

// le partite in corso hanno un timer: aggiorna anche senza nuovi messaggi
setInterval(() => lastSnap && renderDevices(lastSnap.devices, Date.now()), 1000);

function render(s: Snapshot): void {
  renderLeaderboard(s.leaderboardToday);
  renderDevices(s.devices, s.now);
  renderTotals(s);
  renderFeed(s.feed);
  renderRecord(s);
  const cfg = s.config;
  if ($("qr").dataset.url !== cfg.qrUrl) {
    $("qr").innerHTML = cfg.qrSvg;
    $("qr").dataset.url = cfg.qrUrl;
  }
  $("qr-label").textContent = cfg.qrLabel;
  $("school").textContent = cfg.school;
  $("course").textContent = cfg.course;
}

function renderLeaderboard(rows: GameRecord[]): void {
  const list = $("leaderboard");
  if (rows.length === 0) {
    list.innerHTML = `<li class="empty">Ancora nessuna partita oggi. Il primo nome qui lo scegli tu.</li>`;
    return;
  }
  list.innerHTML = rows
    .slice(0, 10)
    .map(
      (g, i) => `
      <li class="row ${i < 3 ? `top top-${i + 1}` : ""}">
        <span class="pos">${i + 1}</span>
        <span class="name">${esc(g.player)}</span>
        <span class="via">${PLATFORM_NAME[g.platform]}</span>
        <span class="pts">${fmt(g.score)}</span>
      </li>`,
    )
    .join("");
}

function renderDevices(devices: DeviceInfo[], now: number): void {
  const list = $("devices");
  const visible = devices.filter((d) => d.online);
  if (visible.length === 0) {
    list.innerHTML = `<li class="empty">Nessuna postazione collegata</li>`;
    return;
  }
  list.innerHTML = visible
    .map((d) => {
      const live = d.live;
      const state = live
        ? `<span class="dev-player">${esc(live.player)}</span>
           <span class="dev-score">${fmt(live.score)}</span>
           <span class="dev-meta"><span class="dev-lives">${"▲".repeat(Math.max(0, live.lives))}</span> ondata ${live.wave}${live.combo > 1 ? ` · combo x${live.combo}` : ""} · ${Math.floor((now - live.startedAt) / 1000)} s</span>`
        : d.nextPlayer
          ? `<span class="dev-player">${esc(d.nextPlayer)}</span><span class="dev-wait">si prepara</span>`
          : `<span class="dev-wait">libera, mettiti in fila</span>`;
      return `<li class="dev ${live ? "is-live" : ""}">
        <span class="dev-label">${esc(d.label)} <small>${PLATFORM_NAME[d.platform]}</small></span>
        ${state}
      </li>`;
    })
    .join("");
}

function renderTotals(s: Snapshot): void {
  const t = s.totalsToday;
  const acc = Math.round(accuracy(t) * 100);
  $("totals").innerHTML = `
    <div><dt>Partite</dt><dd>${fmt(t.games)}</dd></div>
    <div><dt>Asteroidi distrutti</dt><dd>${fmt(t.kills)}</dd></div>
    <div><dt>Colpi sparati</dt><dd>${fmt(t.shots)}</dd></div>
    <div><dt>Precisione media</dt><dd>${acc}%</dd></div>
    <div><dt>Boss sconfitti</dt><dd>${fmt(t.bosses)}</dd></div>
    <div><dt>Tempo in volo</dt><dd>${minutes(t.playMs)}</dd></div>`;
  const best = s.totalsAll.bestByPlatform;
  const entries = (["vr", "ar", "desktop", "mobile"] as const).filter((p) => best[p]);
  $("platforms").innerHTML = entries.length
    ? `<p class="duel">Miglior punteggio per dispositivo</p>` +
      entries
        .map((p) => `<div><dt>${PLATFORM_NAME[p]}</dt><dd>${fmt(best[p]!.score)} <small>${esc(best[p]!.player)}</small></dd></div>`)
        .join("")
    : "";
}

function renderRecord(s: Snapshot): void {
  const top = s.leaderboardAll[0];
  $("record").innerHTML = top
    ? `<span>Record della fiera</span><strong>${fmt(top.score)}</strong><em>${esc(top.player)}</em>`
    : `<span>Record della fiera</span><strong>—</strong><em>ancora libero</em>`;
}

function renderFeed(feed: FeedItem[]): void {
  $("feed").innerHTML = feed
    .slice(0, 6)
    .map((f) => `<li class="feed-${f.kind}">${esc(f.text)}</li>`)
    .join("");
}

/** Un nuovo record della fiera prende tutto lo schermo per qualche secondo. */
function detectRecords(feed: FeedItem[]): void {
  const fresh = feed.filter((f) => !seenFeed.has(f.id));
  seenFeed = new Set(feed.map((f) => f.id));
  if (firstSnapshot) {
    firstSnapshot = false;
    return;
  }
  const rec = fresh.find((f) => f.record)?.record;
  if (!rec) return;
  $("takeover-kicker").textContent = rec.scope === "fair" ? "Nuovo record della fiera" : "Nuovo record di oggi";
  $("takeover-name").textContent = rec.player;
  $("takeover-score").textContent = `${fmt(rec.score)} punti`;
  const el = $("takeover");
  el.hidden = false;
  el.classList.remove("play");
  void el.offsetWidth;
  el.classList.add("play");
  setTimeout(() => (el.hidden = true), 6500);
}
