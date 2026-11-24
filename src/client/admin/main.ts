import "../common/tokens.css";
import "./admin.css";

import { PLATFORM_NAME, type AdminMsg, type DeviceInfo, type Snapshot } from "../../shared/protocol.ts";
import { clock, duration, esc, fmt } from "../common/format.ts";
import { Link } from "../common/net.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let pin = sessionStorage.getItem("orbita.pin") ?? "";
const link = new Link(() => ({ t: "hello", role: "admin", pin }));
const send = (m: AdminMsg) => link.send(m);
let snap: Snapshot | null = null;

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
    render();
  }
});

$("pin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  pin = $<HTMLInputElement>("pin").value;
  sessionStorage.setItem("orbita.pin", pin);
  link.rehello();
});

// ---------- postazioni ----------

const STATUS: Record<DeviceInfo["status"], string> = {
  idle: "Libera",
  ready: "Pronta",
  playing: "In partita",
  over: "Partita finita",
};

/** Non ridisegnare un campo mentre l'operatore ci sta scrivendo. */
function isEditing(): boolean {
  const a = document.activeElement;
  return a instanceof HTMLInputElement && !!a.closest("#devices");
}

function renderDevices(s: Snapshot): void {
  if (isEditing()) return;
  const list = s.devices;
  $("devices").innerHTML = list.length
    ? list
        .map((d) => {
          const live = d.live
            ? `<p class="live"><b>${esc(d.live.player)}</b> sta giocando: <b>${fmt(d.live.score)}</b> punti, ${d.live.lives} vite, ondata ${d.live.wave}</p>`
            : d.nextPlayer
              ? `<p class="live">Prossimo: <b>${esc(d.nextPlayer)}</b></p>`
              : "";
          return `<article class="device ${d.online ? "" : "offline"} st-${d.status}" data-id="${esc(d.id)}">
            <header>
              <input class="label" value="${esc(d.label)}" aria-label="Nome postazione" maxlength="18" />
              <span class="tag">${PLATFORM_NAME[d.platform]}</span>
              <span class="state">${d.online ? STATUS[d.status] : "Scollegata"}</span>
            </header>
            ${live}
            <form class="assign inline">
              <input name="name" maxlength="18" placeholder="Nome del prossimo pilota" autocomplete="off" />
              <button class="btn primary">Assegna</button>
              <button type="button" class="btn" data-act="next" ${s.queue.length ? "" : "disabled"}>Primo in coda</button>
            </form>
            <div class="tools">
              ${d.nextPlayer ? `<button type="button" class="link" data-act="unassign">Togli nome</button>` : ""}
              ${d.live ? `<button type="button" class="link danger" data-act="stop">Termina partita</button>` : ""}
              ${d.online ? "" : `<button type="button" class="link" data-act="forget">Rimuovi</button>`}
            </div>
          </article>`;
        })
        .join("")
    : `<p class="empty">Nessuna postazione. Apri il gioco su un visore o un PC collegato all'hotspot.</p>`;
}

$("devices").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const id = form.closest<HTMLElement>(".device")!.dataset.id!;
  const input = form.elements.namedItem("name") as HTMLInputElement;
  if (!input.value.trim()) return;
  send({ t: "admin:assign", deviceId: id, name: input.value });
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

// ---------- partite ----------

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

$("info-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("info-text");
  if (input.value.trim()) send({ t: "admin:feed:info", text: input.value });
  input.value = "";
});

function render(): void {
  if (!snap) return;
  const s = snap;
  renderDevices(s);
  $("queue").innerHTML = s.queue.length
    ? s.queue.map((n, i) => `<li><span>${esc(n)}</span><button class="link" data-index="${i}" aria-label="Togli ${esc(n)} dalla coda">Togli</button></li>`).join("")
    : `<li class="empty">Coda vuota</li>`;
  $("games").innerHTML = s.recent
    .map(
      (g) => `<tr>
        <td><b>${esc(g.player)}</b><br /><small>${clock(g.endedAt)} · ${duration(g.durationMs)}</small></td>
        <td class="num">${fmt(g.score)}</td>
        <td>${esc(g.deviceLabel)}</td>
        <td class="row-tools">
          <button class="link" data-game="${g.id}" data-act="rename" data-name="${esc(g.player)}">Rinomina</button>
          <button class="link danger" data-game="${g.id}" data-act="delete">Elimina</button>
        </td>
      </tr>`,
    )
    .join("");
  $("play-url").textContent = s.config.playUrl || `${location.origin}/`;
  $("phones").textContent = s.phones.online
    ? `${s.phones.online} telefoni di visitatori collegati, ${s.phones.playing} in partita`
    : "Nessun telefono di visitatori collegato";
}
