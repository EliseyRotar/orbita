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
  type SpectatorMsg,
} from "../shared/protocol.ts";
import { fairDay, type Records } from "./records.ts";

type Role = "device" | "tv" | "admin" | "spectator";

/** Una connessione WebSocket, qualunque sia il server (Node `ws` o Cloudflare). */
export interface Sock {
  send(data: string): void;
  readonly open: boolean;
}

export interface HubOptions {
  /** PIN del pannello operatore. */
  adminPin: string;
  /** Online il pannello operatore deve avere un PIN: senza, l'accesso è negato. */
  requirePin: boolean;
}

interface Conn {
  ws: Sock;
  /** Limite di messaggi: protegge la quota gratuita di Cloudflare da client impazziti. */
  tokens: number;
  lastRefill: number;
  role: Role | null;
  deviceId: string | null;
  /** Spettatore: postazione scelta a mano (null = automatico). */
  pick: string | null;
  /** Spettatore: postazione che sta seguendo adesso. */
  following: string | null;
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
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Postazioni che stanno mandando fotogrammi agli spettatori. */
  private watched = new Set<string>();

  constructor(
    private readonly store: Records,
    private readonly config: () => PublicConfig,
    private readonly opts: HubOptions,
  ) {
    // ogni 30 s ricalcola (cambio giorno, durata partite) anche senza eventi
    const t = setInterval(() => this.changed(), 30_000) as unknown as { unref?: () => void };
    t.unref?.();
  }

  /** Nuova connessione: restituisce le funzioni da chiamare per i messaggi e la chiusura. */
  connect(ws: Sock): { message(raw: string): void; close(): void } {
    const conn: Conn = { ws, tokens: 40, lastRefill: Date.now(), role: null, deviceId: null, pick: null, following: null };
    this.conns.add(conn);
    return {
      message: (raw) => {
        if (!this.allow(conn) || raw.length > 64 * 1024) return;
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        try {
          this.handle(conn, msg);
        } catch (err) {
          console.error("[hub] errore messaggio", msg?.t, err);
        }
      },
      close: () => this.disconnect(conn),
    };
  }

  /** Al massimo ~20 messaggi al secondo per connessione (con piccola riserva). */
  private allow(conn: Conn): boolean {
    const now = Date.now();
    conn.tokens = Math.min(40, conn.tokens + ((now - conn.lastRefill) / 1000) * 20);
    conn.lastRefill = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  private disconnect(conn: Conn): void {
    if (!this.conns.delete(conn)) return;
    if (conn.role === "spectator") this.updateWatch();
    if (!conn.deviceId) return;
    const dev = this.devices.get(conn.deviceId);
    const stillOpen = [...this.conns].some((c) => c.deviceId === conn.deviceId);
    if (!dev || stillOpen) return;
    if (dev.platform === "mobile") {
      // i telefoni dei visitatori non restano nell'elenco: vanno e vengono
      this.devices.delete(dev.id);
    } else {
      dev.online = false;
    }
    this.changed();
  }

  private handle(conn: Conn, msg: ClientMsg): void {
    if (msg.t === "hello") {
      if (msg.role === "admin") {
        const { adminPin, requirePin } = this.opts;
        if (requirePin && !adminPin) {
          this.send(conn.ws, { t: "denied", reason: "PIN operatore non configurato sul server" });
          return;
        }
        if (adminPin && msg.pin !== adminPin) {
          this.send(conn.ws, { t: "denied", reason: "PIN errato" });
          return;
        }
      }
      conn.role = msg.role;
      if (msg.role === "device") this.registerDevice(conn, msg.deviceId, msg.label, msg.platform);
      this.send(conn.ws, { t: "welcome", role: msg.role });
      if (msg.role !== "device") this.send(conn.ws, { t: "snapshot", data: this.snapshot() });
      if (msg.role === "spectator") this.updateWatch();
      return;
    }
    if (msg.t === "spectate:select" && conn.role === "spectator") {
      conn.pick = (msg as SpectatorMsg).deviceId;
      this.updateWatch();
      return;
    }
    if (msg.t === "game:frame") {
      if (conn.role === "device" && conn.deviceId) this.relayFrame(conn.deviceId, msg.frame);
      return;
    }
    const isDeviceMsg = msg.t.startsWith("game:") || msg.t.startsWith("device:");
    if (isDeviceMsg && conn.role === "device" && conn.deviceId) this.handleDevice(conn.deviceId, msg as DeviceMsg);
    else if (msg.t.startsWith("admin:") && conn.role === "admin") this.handleAdmin(msg as AdminMsg);
  }

  private registerDevice(conn: Conn, rawId: string, rawLabel: string, platform: Platform): void {
    const id = String(rawId).slice(0, 64) || crypto.randomUUID();
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
      if (this.watched.has(id)) this.send(conn.ws, { t: "watch", on: true });
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
        const player = cleanName(msg.player) || dev.nextPlayer || dev.label;
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
        // controllo di buon senso: nessuno fa più di ~400 punti al secondo (più i boss)
        const elapsed = (Date.now() - dev.live.startedAt) / 1000;
        const maxScore = Math.round(elapsed * 400 + num(s.bosses) * 3000 + 2000);
        const prevBestAll = this.store.leaderboard(null, 1)[0]?.score ?? 0;
        const prevBestToday = this.store.leaderboard(fairDay(), 1)[0]?.score ?? 0;
        const rec = this.store.add({
          player: dev.live.player,
          platform: dev.platform,
          deviceLabel: dev.label,
          score: Math.min(num(s.score), maxScore),
          kills: num(s.kills),
          enemies: num(s.enemies),
          shots: num(s.shots),
          hits: Math.min(num(s.hits), num(s.shots)),
          maxCombo: num(s.maxCombo),
          bosses: num(s.bosses),
          wave: num(s.wave),
          durationMs: Math.min(num(s.durationMs), elapsed * 1000 + 5000, 60 * 60 * 1000),
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
        this.overAt.set(dev.id, Date.now());
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
    this.feed.unshift({ id: crypto.randomUUID(), kind, text, at: Date.now(), record });
    if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX;
  }

  snapshot(): Snapshot {
    const today = fairDay();
    return {
      now: Date.now(),
      today,
      devices: [...this.devices.values()]
        .filter((d) => d.platform !== "mobile")
        .sort((a, b) => a.label.localeCompare(b.label, "it", { numeric: true })),
      phones: this.phoneCount(),
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

  private phoneCount(): { online: number; playing: number } {
    let online = 0;
    let playing = 0;
    for (const d of this.devices.values()) {
      if (d.platform !== "mobile" || !d.online) continue;
      online++;
      if (d.live) playing++;
    }
    return { online, playing };
  }

  /** Raggruppa le modifiche: al massimo ~6 snapshot al secondo verso TV e operatore. */
  private changed(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const data = JSON.stringify({ t: "snapshot", data: this.snapshot() } satisfies ServerMsg);
      for (const c of this.conns) if (c.role === "tv" || c.role === "admin" || c.role === "spectator") this.sendRaw(c.ws, data);
      this.updateWatch();
    }, 160);
  }

  // ---------------- spettatori ----------------

  /**
   * Decide chi segue ogni spettatore (scelta manuale o, in automatico, la partita
   * con più punti) e accende lo streaming solo sulle postazioni guardate.
   */
  private updateWatch(): void {
    const live = [...this.devices.values()].filter((d) => d.online && d.live);
    const best = live.sort((a, b) => b.live!.score - a.live!.score)[0]?.id ?? null;
    const want = new Set<string>();
    for (const c of this.conns) {
      if (c.role !== "spectator") continue;
      let target: string | null;
      if (c.pick && this.devices.get(c.pick)?.online) target = c.pick;
      else if (c.following && this.devices.get(c.following)?.live) target = c.following;
      else target = best;
      // in automatico cambia partita solo se quella seguita è finita da qualche secondo
      if (!c.pick && c.following && target !== c.following) {
        const cur = this.devices.get(c.following);
        if (cur?.status === "over" && cur.online && Date.now() - (this.overAt.get(cur.id) ?? 0) < 6000) target = c.following;
      }
      if (target !== c.following) {
        c.following = target;
        this.send(c.ws, { t: "following", deviceId: target });
      }
      if (target) want.add(target);
    }
    for (const id of want) if (!this.watched.has(id)) this.sendToDevice(id, { t: "watch", on: true });
    for (const id of this.watched) if (!want.has(id)) this.sendToDevice(id, { t: "watch", on: false });
    this.watched = want;
  }

  private overAt = new Map<string, number>();

  private relayFrame(deviceId: string, frame: unknown): void {
    if (!frame || typeof frame !== "object") return;
    const data = JSON.stringify({ t: "frame", data: { ...(frame as object), deviceId } });
    if (data.length > 48_000) return;
    for (const c of this.conns) if (c.role === "spectator" && c.following === deviceId) this.sendRaw(c.ws, data);
  }

  private sendToDevice(id: string, msg: ServerMsg): void {
    for (const c of this.conns) if (c.deviceId === id) this.send(c.ws, msg);
  }

  private send(ws: Sock, msg: ServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: Sock, data: string): void {
    if (!ws.open) return;
    try {
      ws.send(data);
    } catch {
      /* connessione appena chiusa */
    }
  }
}
