import "../common/tokens.css";
import "./tv.css";

import { accuracy, type DeviceInfo, type FeedItem, type GameRecord, type Platform, type Snapshot } from "../../shared/protocol.ts";
import { esc, fmt, minutes } from "../common/format.ts";
import { Link } from "../common/net.ts";
import QRCode from "qrcode";

const $ = (id: string) => document.getElementById(id)!;
const link = new Link(() => ({ t: "hello", role: "tv" }));

const ORD = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH", "7TH", "8TH", "9TH", "10TH"];
const ROW_COLORS = ["var(--yellow)", "var(--pink)", "var(--cyan)", "var(--green)"];
const VIA: Record<Platform, string> = { desktop: "PC", vr: "QUEST", ar: "HOLO", mobile: "TEL" };

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

// i secondi delle partite in corso avanzano anche senza nuovi messaggi
setInterval(() => lastSnap && renderDevices(lastSnap.devices, Date.now(), lastSnap.phones), 1000);

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(6, "0");

/**
 * Classifica: il miglior punteggio di ogni giocatore di oggi, da tutti i dispositivi
 * (telefoni compresi). Se sono più di 10 le pagine scorrono da sole: la prima resta di più.
 */
const PAGE = 10;
let page = 0;
let shownPage = -1;
let pageT = 0;
setInterval(() => {
  if (!lastSnap) return;
  const pages = Math.max(1, Math.ceil(lastSnap.bestToday.length / PAGE));
  pageT++;
  if (pages === 1) page = 0;
  else if (pageT >= (page === 0 ? 3 : 2)) {
    pageT = 0;
    page = (page + 1) % pages;
  } else return;
  renderLeaderboard(lastSnap.bestToday);
}, 4000);

function render(s: Snapshot): void {
  renderLeaderboard(s.bestToday);
  const last = s.last;
  $("last").innerHTML = last
    ? `ULTIMA PARTITA <b>${esc(last.game.player.toUpperCase())}</b> ${pad(last.game.score)} <span>${last.rankToday ? `${last.rankToday}° OGGI` : ""} · ${VIA[last.game.platform]}</span>`
    : "";
  renderDevices(s.devices, s.now, s.phones);
  renderTotals(s);
  renderFeed(s.feed);
  renderRecord(s);
  const cfg = s.config;
  void drawQr("qr", cfg.qrUrl);
  void drawQr("qr-play", cfg.playUrl || location.origin);
  $("qr-label").textContent = cfg.qrLabel.toUpperCase();
  $("course").textContent = `${cfg.school}, ${cfg.course}`;
}

async function drawQr(id: string, url: string): Promise<void> {
  const el = $(id);
  if (el.dataset.url === url) return;
  el.dataset.url = url;
  el.innerHTML = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

function renderLeaderboard(rows: GameRecord[]): void {
  const list = $("leaderboard");
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (page >= pages) page = 0;
  const from = page * PAGE;
  const top = rows[0]?.score || 1;
  const filled = Array.from({ length: PAGE }, (_, i) => rows[from + i] ?? null);
  list.innerHTML = filled
    .map((g, k) => {
      const i = from + k;
      const color = !g ? "var(--dim)" : i < 4 ? ROW_COLORS[i]! : "var(--white)";
      const bar = g ? Math.max(0.02, g.score / top).toFixed(3) : 0;
      return `<li class="row ${g ? "" : "empty"}" style="color:${color};--bar:${bar}">
        <span class="pos">${ORD[i] ?? `${i + 1}TH`}</span>
        <span class="name">${g ? esc(g.player.toUpperCase()) : "---"}</span>
        <span class="pts">${g ? pad(g.score) : "000000"}</span>
        <span class="via v-${g?.platform ?? ""}">${g ? VIA[g.platform] : ""}</span>
      </li>`;
    })
    .join("");
  // animazione solo al cambio pagina, non a ogni aggiornamento dei punti
  if (shownPage !== page) {
    shownPage = page;
    list.classList.remove("flip");
    void list.offsetWidth;
    list.classList.add("flip");
  }
  $("hs-page").textContent = rows.length > PAGE ? `${from + 1}-${Math.min(rows.length, from + PAGE)} DI ${rows.length} · PAG ${page + 1}/${pages}` : rows.length ? `${rows.length} PILOTI OGGI` : "";
}

function renderDevices(devices: DeviceInfo[], now: number, phones: Snapshot["phones"]): void {
  const list = $("devices");
  // visori e PC sempre; i telefoni solo mentre giocano
  const visible = devices.filter((d) => d.online && (d.platform !== "mobile" || d.live));
  const extra = phones.online - devices.filter((d) => d.platform === "mobile" && d.online && d.live).length;
  const phoneRow = extra > 0
    ? `<li class="dev"><span class="dev-label">TELEFONI</span><span class="dev-who">${phones.online} COLLEGATI DAL QR</span></li>`
    : "";
  if (visible.length === 0) {
    list.innerHTML = `<li class="dev idle"><span>nessun visore collegato</span></li>${phoneRow}`;
    return;
  }
  list.innerHTML = visible
    .map((d) => {
      const live = d.live;
      const who = live ? live.player.toUpperCase() : d.nextPlayer ? `${d.nextPlayer.toUpperCase()} SI PREPARA` : "LIBERO";
      const right = live ? `<span class="dev-score">${pad(live.score)}</span>` : `<span class="dev-free">${d.nextPlayer ? "PRONTO" : "IN FILA!"}</span>`;
      const meta = live ? `<span class="dev-meta">ond.${live.wave} ${Math.floor((now - live.startedAt) / 1000)}s</span>` : "";
      return `<li class="dev ${live ? "live" : ""}">
        <span class="dev-label">${esc(d.label.toUpperCase())}</span>
        <span class="dev-who">${esc(who)}</span>
        ${meta}
        ${right}
      </li>`;
    })
    .join("") + phoneRow;
}

function renderTotals(s: Snapshot): void {
  const t = s.totalsToday;
  $("totals").innerHTML = `
    <div><dt>PARTITE</dt><dd>${fmt(t.games)}</dd></div>
    <div><dt>ASTEROIDI</dt><dd>${fmt(t.kills)}</dd></div>
    <div><dt>NEMICI</dt><dd>${fmt(t.enemies)}</dd></div>
    <div><dt>BOSS</dt><dd>${fmt(t.bosses)}</dd></div>
    <div><dt>PRECISIONE</dt><dd>${Math.round(accuracy(t) * 100)}%</dd></div>
    <div><dt>IN VOLO</dt><dd>${minutes(t.playMs)}</dd></div>`;

  // record di sempre per tipo di dispositivo, dal migliore al peggiore
  const best = s.totalsAll.bestByPlatform;
  const duel = (Object.keys(best) as Platform[])
    .map((p) => ({ p, ...best[p]! }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  $("duel").innerHTML = duel.length
    ? duel.map((d) => `<li><span class="duel-dev">${VIA[d.p]}</span><span class="duel-who">${esc(d.player.toUpperCase())}</span><span class="duel-pts">${pad(d.score)}</span></li>`).join("")
    : `<li class="duel-empty">gioca per primo e porta in testa il tuo dispositivo</li>`;
}

function renderRecord(s: Snapshot): void {
  const top = s.leaderboardAll[0];
  $("record").innerHTML = top
    ? `<p class="rec-k">RECORD DELLA FIERA</p><p class="rec-score">${pad(top.score)}</p><p class="rec-who">${esc(top.player.toUpperCase())} · ${VIA[top.platform]}</p>`
    : `<p class="rec-k">RECORD DELLA FIERA</p><p class="rec-score">000000</p><p class="rec-who">ANCORA LIBERO: PRENDILO TU</p>`;
}

function renderFeed(feed: FeedItem[]): void {
  $("feed").innerHTML = feed
    .slice(0, 5)
    .map((f) => `<li class="feed-${f.kind}">${esc(f.text)}</li>`)
    .join("");
}

/** Un nuovo record prende tutto lo schermo per qualche secondo. */
function detectRecords(feed: FeedItem[]): void {
  const fresh = feed.filter((f) => !seenFeed.has(f.id));
  seenFeed = new Set(feed.map((f) => f.id));
  if (firstSnapshot) {
    firstSnapshot = false;
    return;
  }
  const rec = fresh.find((f) => f.record)?.record;
  if (!rec) return;
  $("takeover-kicker").textContent = rec.scope === "fair" ? "NUOVO RECORD DELLA FIERA" : "NUOVO RECORD DI OGGI";
  $("takeover-name").textContent = rec.player.toUpperCase();
  $("takeover-score").textContent = pad(rec.score);
  const el = $("takeover");
  el.hidden = false;
  el.classList.remove("play");
  void el.offsetWidth;
  el.classList.add("play");
  setTimeout(() => (el.hidden = true), 6500);
}
