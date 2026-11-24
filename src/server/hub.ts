import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  cleanName,
  type AdminMsg,
  type ClientMsg,
  type DeviceInfo,
  type DeviceMsg,
  type FeedItem,
  type FeedKind,
  type Platform,
  type PublicConfig,
  type ServerMsg,
  type Snapshot,
} from "../shared/protocol.ts";
import { fairDay, type Store } from "./store.ts";

type Role = "device" | "tv" | "admin";

interface Conn {
  ws: WebSocket;
  role: Role | null;
  deviceId: string | null;
}

const PLATFORMS: Platform[] = ["desktop", "vr", "ar", "mobile"];
const FEED_MAX = 30;

/**
 * Stato condiviso della fiera: postazioni collegate, partite in corso, coda dei
 * giocatori e feed degli eventi. Ogni modifica genera uno snapshot per TV e operatore.
 */
export class Hub {
  private conns = new Set<Conn>();
  private devices = new Map<string, DeviceInfo>();
  private queue: string[] = [];
  private feed: FeedItem[] = [];
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly config: () => PublicConfig,
    private readonly adminPin: string,
  ) {
    // ogni 30 s ricalcola (cambio giorno, durata partite) anche senza eventi
    setInterval(() => this.changed(), 30_000).unref();
  }

  attach(ws: WebSocket): void {
    const conn: Conn = { ws, role: null, deviceId: null };
    this.conns.add(conn);
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        this.handle(conn, msg);
      } catch (err) {
        console.error("[hub] errore messaggio", msg?.t, err);
      }
    });
    ws.on("close", () => {
      this.conns.delete(conn);
      if (conn.deviceId) {
        const dev = this.devices.get(conn.deviceId);
        const stillOpen = [...this.conns].some((c) => c.deviceId === conn.deviceId);
        if (dev && !stillOpen) {
          dev.online = false;
          this.changed();
        }
      }
    });
  }

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === "hello") {
      if (msg.role === "admin" && this.adminPin && msg.pin !== this.adminPin) {
        this.send(conn.ws, { t: "denied", reason: "PIN errato" });
        return;
      }
      conn.role = msg.role;
      if (msg.role === "device") this.registerDevice(conn, msg.deviceId, msg.label, msg.platform);
      this.send(conn.ws, { t: "welcome", role: msg.role });
      if (msg.role !== "device") this.send(conn.ws, { t: "snapshot", data: this.snapshot() });
      return;
    }
    const isDeviceMsg = msg.t.startsWith("game:") || msg.t.startsWith("device:");
    if (isDeviceMsg && conn.role === "device" && conn.deviceId) this.handleDevice(conn.deviceId, msg as DeviceMsg);
    else if (msg.t.startsWith("admin:") && conn.role === "admin") this.handleAdmin(msg as AdminMsg);
  }

  private registerDevice(conn: Conn, rawId: string, rawLabel: string, platform: Platform): void {
    const id = String(rawId).slice(0, 64) || randomUUID();
    conn.deviceId = id;
    const label = cleanName(rawLabel) || "Postazione";
    const existing = this.devices.get(id);
    if (existing) {
      existing.online = true;
      existing.label = label;
      existing.platform = PLATFORMS.includes(platform) ? platform : existing.platform;
      // una partita rimasta "in corso" dopo una disconnessione viene annullata
      if (existing.status === "playing") {
        existing.status = "idle";
        existing.live = null;
      }
      this.send(conn.ws, { t: "assign", name: existing.nextPlayer });
    } else {
      this.devices.set(id, {
        id,
        label,
        platform: PLATFORMS.includes(platform) ? platform : "desktop",
        online: true,
        status: "idle",
        nextPlayer: null,
        live: null,
      });
    }
    this.changed();
  }

  private handleDevice(id: string, msg: DeviceMsg): void {
    const dev = this.devices.get(id);
    if (!dev) return;
    switch (msg.t) {
      case "device:platform":
        if (PLATFORMS.includes(msg.platform)) dev.platform = msg.platform;
        break;
      case "device:label":
        dev.label = cleanName(msg.label) || dev.label;
        break;
      case "game:start": {
        const player = cleanName(msg.player) || dev.nextPlayer || "Ospite";
        dev.nextPlayer = null;
        dev.status = "playing";
        dev.live = { player, score: 0, lives: 3, combo: 1, wave: 1, startedAt: Date.now() };
        this.pushFeed("start", `${player} è in volo su ${dev.label}`);
        break;
      }
      case "game:tick":
        if (dev.live) {
          dev.live.score = Math.max(0, Math.floor(msg.score));
          dev.live.lives = msg.lives;
          dev.live.combo = msg.combo;
          dev.live.wave = msg.wave;
        }
        break;
      case "game:event":
        if (dev.live && (msg.kind === "boss" || msg.kind === "combo")) {
          this.pushFeed(msg.kind, `${dev.live.player}: ${String(msg.text).slice(0, 80)}`);
        }
        break;
      case "game:end": {
        if (!dev.live) break;
        const s = msg.stats;
        const num = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0);
        const prevBestAll = this.store.leaderboard(null, 1)[0]?.score ?? 0;
        const prevBestToday = this.store.leaderboard(fairDay(), 1)[0]?.score ?? 0;
        const rec = this.store.add({
          player: dev.live.player,
          platform: dev.platform,
          deviceLabel: dev.label,
          score: num(s.score),
          kills: num(s.kills),
          shots: num(s.shots),
          hits: Math.min(num(s.hits), num(s.shots)),
          maxCombo: num(s.maxCombo),
          bosses: num(s.bosses),
          wave: num(s.wave),
          durationMs: Math.min(num(s.durationMs), 60 * 60 * 1000),
        });
        const rankToday = this.store.rankOf(rec, rec.day);
        const rankAll = this.store.rankOf(rec, null);
        const isRecord = rec.score > 0 && rec.score > prevBestAll;
        if (isRecord) this.pushFeed("record", `Nuovo record della fiera: ${rec.player} con ${rec.score} punti!`, { player: rec.player, score: rec.score, scope: "fair" });
        else if (rec.score > 0 && rec.score > prevBestToday) this.pushFeed("record", `Record di oggi: ${rec.player}, ${rec.score} punti`, { player: rec.player, score: rec.score, scope: "day" });
        else this.pushFeed("end", `${rec.player} chiude a ${rec.score} punti (${rankToday}° oggi)`);
        for (const c of this.conns) {
          if (c.deviceId === id) this.send(c.ws, { t: "rank", gameId: rec.id, rankToday, rankAll, isRecord });
        }
        dev.status = "over";
        dev.live = null;
        break;
      }
      case "game:abort":
        dev.status = "idle";
        dev.live = null;
        break;
    }
    this.changed();
  }

  private handleAdmin(msg: AdminMsg): void {
    switch (msg.t) {
      case "admin:assign":
      case "admin:unassign": {
        const dev = this.devices.get(msg.deviceId);
        if (!dev) return;
        dev.nextPlayer = msg.t === "admin:assign" ? cleanName(msg.name) || null : null;
        if (dev.status === "over" && dev.nextPlayer) dev.status = "ready";
        if (dev.status === "ready" && !dev.nextPlayer) dev.status = "idle";
        if (dev.status === "idle" && dev.nextPlayer) dev.status = "ready";
        this.sendToDevice(dev.id, { t: "assign", name: dev.nextPlayer });
        break;
      }
      case "admin:queue:next": {
        const dev = this.devices.get(msg.deviceId);
        const name = this.queue.shift();
        if (!dev || !name) return;
        dev.nextPlayer = name;
        if (dev.status !== "playing") dev.status = "ready";
        this.sendToDevice(dev.id, { t: "assign", name });
        break;
      }
      case "admin:rename": {
        const dev = this.devices.get(msg.deviceId);
        if (!dev) return;
        dev.label = cleanName(msg.label) || dev.label;
        break;
      }
      case "admin:forget":
        this.devices.delete(msg.deviceId);
        break;
      case "admin:stop":
        this.sendToDevice(msg.deviceId, { t: "stop" });
        break;
      case "admin:queue:add": {
        const name = cleanName(msg.name);
        if (name && this.queue.length < 50) this.queue.push(name);
        break;
      }
      case "admin:queue:remove":
        this.queue.splice(msg.index, 1);
        break;
      case "admin:game:delete":
        this.store.remove(msg.id);
        break;
      case "admin:game:rename": {
        const player = cleanName(msg.player);
        if (player) this.store.rename(msg.id, player);
        break;
      }
      case "admin:feed:info": {
        const text = String(msg.text).trim().slice(0, 120);
        if (text) this.pushFeed("info", text);
        break;
      }
    }
    this.changed();
  }

  private pushFeed(kind: FeedKind, text: string, record?: FeedItem["record"]): void {
    this.feed.unshift({ id: randomUUID(), kind, text, at: Date.now(), record });
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
  }

  snapshot(): Snapshot {
    const today = fairDay();
    return {
      now: Date.now(),
      today,
      devices: [...this.devices.values()].sort((a, b) => a.label.localeCompare(b.label, "it", { numeric: true })),
      leaderboardToday: this.store.leaderboard(today, 15),
      leaderboardAll: this.store.leaderboard(null, 15),
      recent: this.store.recent(25),
      totalsToday: this.store.totals(today),
      totalsAll: this.store.totals(null),
      feed: this.feed,
      queue: this.queue,
      config: this.config(),
    };
  }

  /** Raggruppa le modifiche: al massimo ~6 snapshot al secondo verso TV e operatore. */
  private changed(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const data = JSON.stringify({ t: "snapshot", data: this.snapshot() } satisfies ServerMsg);
      for (const c of this.conns) if (c.role === "tv" || c.role === "admin") this.sendRaw(c.ws, data);
    }, 160);
  }

  private sendToDevice(id: string, msg: ServerMsg): void {
    for (const c of this.conns) if (c.deviceId === id) this.send(c.ws, msg);
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}
