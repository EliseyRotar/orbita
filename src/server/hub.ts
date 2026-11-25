import {
  cleanName,
  DEFAULT_SETTINGS,
  DIFFICULTY_PRESETS,
  type AdminMsg,
  type ClientMsg,
  type CurrentGame,
  type DeviceInfo,
  type DeviceMsg,
  type Difficulty,
  type FeedItem,
  type FeedKind,
  type OtherPilot,
  type Platform,
  type PublicConfig,
  type ServerMsg,
  type Settings,
  type Snapshot,
  type VisualStyle,
} from "../shared/protocol.ts";
import { fairDay, type Records } from "./records.ts";

type Role = "device" | "tv" | "admin" | "spectator";

/** Una connessione WebSocket, qualunque sia il server (Node `ws` o Cloudflare). */
export interface Sock {
  send(data: string): void;
  readonly open: boolean;
  /** Chiude la connessione (per client che mandano troppi messaggi). */
  close?(): void;
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
  strikes: number;
  role: Role | null;
  deviceId: string | null;
  /** Spettatore: postazione scelta a mano (null = automatico). */
  pick: string | null;
  /** Spettatore: vuole la griglia con tutti. */
  grid: boolean;
  /** Spettatore: postazione che sta seguendo adesso (vista singola). */
  following: string | null;
}

interface DeviceState extends DeviceInfo {
  /** Codice della partita in corso (per riconoscerla dopo una riconnessione). */
  gameId: string | null;
}

const PLATFORMS: Platform[] = ["desktop", "vr", "ar", "mobile"];
const STYLES: VisualStyle[] = ["neon", "realistico", "ologramma"];
const FEED_MAX = 30;
/** Dopo quanti secondi senza segni di vita una partita è "segnale perso" e poi viene chiusa. */
const LOST_AFTER = 15_000;
const CLOSE_AFTER = 60_000;
const MAX_DEVICES = 120;

const num = (v: unknown, max = 1e9) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v as number))) : 0);
const clampMult = (v: unknown, fallback: number) => (Number.isFinite(v) ? Math.max(0.3, Math.min(3, Number(v))) : fallback);

/**
 * Stato condiviso della fiera: postazioni collegate, partite in corso, coda dei
 * giocatori, impostazioni e feed degli eventi. Ogni modifica genera uno snapshot
 * per monitor, spettatore e operatore.
 */
export class Hub {
  private conns = new Set<Conn>();
  private devices = new Map<string, DeviceState>();
  private queue: string[] = [];
  private feed: FeedItem[] = [];
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Postazioni che stanno mandando fotogrammi agli spettatori. */
  private watched = new Set<string>();
  /** Partite già salvate (per non salvarle due volte se il messaggio arriva doppio). */
  private savedGames = new Set<string>();
  private overAt = new Map<string, number>();
  private settings: Settings;

  constructor(
    private readonly store: Records,
    private readonly config: () => PublicConfig,
    private readonly opts: HubOptions,
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...store.loadSettings() };
    // controllo ogni 5 s: partite senza segni di vita, cambio giorno, durate
    let ticks = 0;
    const t = setInterval(() => {
      this.watchdog();
      if (++ticks % 6 === 0) this.changed();
    }, 5_000) as unknown as { unref?: () => void };
    t.unref?.();
  }

  /** Nuova connessione: restituisce le funzioni da chiamare per i messaggi e la chiusura. */
  connect(ws: Sock): { message(raw: string): void; close(): void } {
    const conn: Conn = { ws, tokens: 40, lastRefill: Date.now(), strikes: 0, role: null, deviceId: null, pick: null, grid: false, following: null };
    this.conns.add(conn);
    return {
      message: (raw) => {
        if (raw.length > 64 * 1024) return;
        if (!this.allow(conn)) {
          // chi insiste a mandare troppi messaggi viene scollegato
          if (++conn.strikes > 200) conn.ws.close?.();
          return;
        }
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
        try {
          this.handle(conn, msg);
        } catch (err) {
          console.error("[hub] errore messaggio", msg.t, err);
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
    dev.online = false;
    // un telefono senza partita in corso esce dall'elenco; se stava giocando resta,
    // così se si riconnette (schermo sbloccato, rete tornata) la partita continua
    if (dev.platform === "mobile" && !dev.live) this.devices.delete(dev.id);
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
      if (!["device", "tv", "admin", "spectator"].includes(msg.role)) return;
      conn.role = msg.role;
      if (msg.role === "device") {
        this.registerDevice(conn, msg.deviceId, msg.label, msg.platform, msg.game ?? null);
        this.sendTop(conn.ws);
        this.send(conn.ws, { t: "settings", settings: this.settings });
      }
      this.send(conn.ws, { t: "welcome", role: msg.role });
      if (msg.role !== "device") this.send(conn.ws, { t: "snapshot", data: this.snapshot() });
      if (msg.role === "spectator") this.updateWatch();
      return;
    }
    if (conn.role === "spectator") {
      if (msg.t === "spectate:select") {
        conn.pick = typeof msg.deviceId === "string" ? msg.deviceId : null;
        conn.grid = false;
        this.updateWatch();
      } else if (msg.t === "spectate:grid") {
        conn.grid = !!msg.on;
        if (conn.grid) conn.pick = null;
        this.updateWatch();
      }
      return;
    }
    if (msg.t === "game:frame") {
      if (conn.role === "device" && conn.deviceId) {
        const dev = this.devices.get(conn.deviceId);
        if (dev) dev.lastSeen = Date.now();
        this.relayFrame(conn.deviceId, msg.frame);
      }
      return;
    }
    const isDeviceMsg = msg.t.startsWith("game:") || msg.t.startsWith("device:");
    if (isDeviceMsg && conn.role === "device" && conn.deviceId) this.handleDevice(conn, conn.deviceId, msg as DeviceMsg);
    else if (msg.t.startsWith("admin:") && conn.role === "admin") this.handleAdmin(msg as AdminMsg);
  }

  private registerDevice(conn: Conn, rawId: unknown, rawLabel: unknown, rawPlatform: unknown, game: CurrentGame | null): void {
    const id = String(rawId ?? "").slice(0, 64) || crypto.randomUUID();
    conn.deviceId = id;
    const label = cleanName(String(rawLabel ?? "")) || "Postazione";
    const platform = PLATFORMS.includes(rawPlatform as Platform) ? (rawPlatform as Platform) : "desktop";
    let dev = this.devices.get(id);
    if (!dev) {
      if (this.devices.size >= MAX_DEVICES) this.pruneDevices();
      dev = { id, label, platform, online: true, status: "idle", nextPlayer: null, live: null, lastSeen: Date.now(), gameId: null };
      this.devices.set(id, dev);
    }
    dev.online = true;
    dev.label = label;
    dev.platform = platform;
    dev.lastSeen = Date.now();
    // il dispositivo dice se ha una partita in corso: la riprendiamo invece di perderla
    if (game && typeof game.id === "string" && !this.savedGames.has(game.id)) {
      dev.gameId = game.id.slice(0, 64);
      dev.status = "playing";
      dev.live = {
        player: cleanName(String(game.player ?? "")) || dev.label,
        score: num(game.score),
        lives: num(game.lives, 9),
        combo: 1,
        wave: num(game.wave, 999),
        startedAt: this.sanitizeStart(game.startedAt),
      };
    } else if (dev.live) {
      dev.live = null;
      dev.gameId = null;
      dev.status = dev.nextPlayer ? "ready" : "idle";
    }
    this.send(conn.ws, { t: "assign", name: dev.nextPlayer });
    if (this.watched.has(id)) this.send(conn.ws, { t: "watch", on: true });
    this.changed();
  }

  /** Inizio partita plausibile: non nel futuro e non più di un'ora fa. */
  private sanitizeStart(v: unknown): number {
    const now = Date.now();
    const t = Number(v);
    return Number.isFinite(t) && t <= now && t > now - 3_600_000 ? t : now;
  }

  private pruneDevices(): void {
    // tiene l'elenco sotto controllo: via i dispositivi scollegati da più tempo
    const offline = [...this.devices.values()].filter((d) => !d.online && !d.live).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const d of offline.slice(0, 20)) this.devices.delete(d.id);
  }

  private handleDevice(conn: Conn, id: string, msg: DeviceMsg): void {
    const dev = this.devices.get(id);
    if (!dev) return;
    dev.lastSeen = Date.now();
    switch (msg.t) {
      case "device:platform":
        if (PLATFORMS.includes(msg.platform)) dev.platform = msg.platform;
        break;
      case "device:label":
        dev.label = cleanName(String(msg.label ?? "")) || dev.label;
        break;
      case "game:start": {
        const player = cleanName(String(msg.player ?? "")) || dev.nextPlayer || dev.label;
        dev.nextPlayer = null;
        dev.status = "playing";
        dev.gameId = String(msg.id ?? crypto.randomUUID()).slice(0, 64);
        dev.live = { player, score: 0, lives: 3, combo: 1, wave: 1, startedAt: this.sanitizeStart(msg.startedAt) };
        this.pushFeed("start", player === dev.label ? `${player} è in volo` : `${player} è in volo su ${dev.label}`);
        break;
      }
      case "game:tick":
        if (dev.live) {
          dev.live.score = num(msg.score);
          dev.live.lives = num(msg.lives, 9);
          dev.live.combo = Math.max(1, num(msg.combo, 9));
          dev.live.wave = num(msg.wave, 999);
          if (dev.status === "lost") dev.status = "playing";
        }
        break;
      case "game:pause":
        if (dev.live) dev.status = msg.paused ? "paused" : "playing";
        break;
      case "game:event":
        if (dev.live && (msg.kind === "boss" || msg.kind === "combo")) {
          this.pushFeed(msg.kind, `${dev.live.player}: ${String(msg.text ?? "").slice(0, 80)}`);
        }
        break;
      case "game:end":
        this.finishGame(dev, msg, conn);
        break;
      case "game:abort":
        dev.status = "idle";
        dev.live = null;
        dev.gameId = null;
        break;
    }
    this.changed();
  }

  /** Salva una partita finita. Funziona anche se il server l'aveva persa (riconnessione, riavvio). */
  private finishGame(dev: DeviceState, msg: Extract<DeviceMsg, { t: "game:end" }>, conn: Conn | null): void {
    const gameId = String(msg.id ?? "").slice(0, 64) || dev.gameId || crypto.randomUUID();
    if (this.savedGames.has(gameId)) {
      // già salvata: rimandiamo solo la conferma
      return;
    }
    const s = msg.stats ?? ({} as typeof msg.stats);
    const player = dev.live?.player ?? (cleanName(String(msg.player ?? "")) || dev.label);
    const startedAt = dev.live?.startedAt ?? this.sanitizeStart(msg.startedAt);
    // controllo di buon senso: nessuno fa più di ~400 punti al secondo (più i boss)
    const elapsed = (Date.now() - startedAt) / 1000;
    const maxScore = Math.round(elapsed * 400 + num(s.bosses, 50) * 4000 + 2000);
    const prevBestAll = this.store.leaderboard(null, 1)[0]?.score ?? 0;
    const prevBestToday = this.store.leaderboard(fairDay(), 1)[0]?.score ?? 0;
    const rec = this.store.add({
      player,
      platform: dev.platform,
      deviceLabel: dev.label,
      score: Math.min(num(s.score), maxScore),
      kills: num(s.kills),
      enemies: num(s.enemies),
      shots: num(s.shots),
      hits: Math.min(num(s.hits), num(s.shots)),
      maxCombo: num(s.maxCombo, 99),
      bosses: num(s.bosses, 99),
      wave: num(s.wave, 999),
      durationMs: Math.min(num(s.durationMs), elapsed * 1000 + 5000, 3_600_000),
    });
    this.savedGames.add(gameId);
    if (this.savedGames.size > 2000) this.savedGames.clear();
    const rankToday = this.store.rankOf(rec, rec.day);
    const rankAll = this.store.rankOf(rec, null);
    const isRecord = rec.score > 0 && rec.score > prevBestAll;
    if (isRecord) this.pushFeed("record", `Nuovo record della fiera: ${rec.player} con ${rec.score} punti!`, { player: rec.player, score: rec.score, scope: "fair" });
    else if (rec.score > 0 && rec.score > prevBestToday) this.pushFeed("record", `Record di oggi: ${rec.player}, ${rec.score} punti`, { player: rec.player, score: rec.score, scope: "day" });
    else this.pushFeed("end", `${rec.player} chiude a ${rec.score} punti (${rankToday}° oggi)`);
    const rank: ServerMsg = { t: "rank", gameId: rec.id, rankToday, rankAll, isRecord };
    if (conn) this.send(conn.ws, rank);
    else this.sendToDevice(dev.id, rank);
    if (!dev.gameId || dev.gameId === gameId) {
      dev.status = "over";
      dev.live = null;
      dev.gameId = null;
      this.overAt.set(dev.id, Date.now());
    }
  }

  /**
   * Partite senza segni di vita (visore tolto e appoggiato, telefono bloccato, rete persa):
   * dopo 15 s diventano "segnale perso", dopo 60 s vengono chiuse e salvate con l'ultimo punteggio.
   */
  private watchdog(): void {
    const now = Date.now();
    let dirty = false;
    for (const dev of this.devices.values()) {
      if (!dev.live) continue;
      const quiet = now - dev.lastSeen;
      if (dev.status === "paused" && quiet < CLOSE_AFTER * 3) continue;
      if (quiet > CLOSE_AFTER) {
        const live = dev.live;
        this.finishGame(
          dev,
          {
            t: "game:end",
            id: dev.gameId ?? crypto.randomUUID(),
            player: live.player,
            startedAt: live.startedAt,
            stats: { score: live.score, kills: 0, enemies: 0, shots: 0, hits: 0, maxCombo: live.combo, bosses: 0, wave: live.wave, durationMs: dev.lastSeen - live.startedAt },
          },
          null,
        );
        dev.status = dev.online ? "idle" : dev.status;
        if (!dev.online && dev.platform === "mobile") this.devices.delete(dev.id);
        this.pushFeed("info", `${live.player}: partita chiusa per assenza di segnale`);
        dirty = true;
      } else if (quiet > LOST_AFTER && dev.status === "playing") {
        dev.status = "lost";
        dirty = true;
      }
    }
    if (dirty) this.changed();
  }

  private handleAdmin(msg: AdminMsg): void {
    switch (msg.t) {
      case "admin:assign":
      case "admin:unassign": {
        const dev = this.devices.get(msg.deviceId);
        if (!dev) return;
        dev.nextPlayer = msg.t === "admin:assign" ? cleanName(String(msg.name ?? "")) || null : null;
        if (!dev.live) dev.status = dev.nextPlayer ? "ready" : dev.status === "over" ? "over" : "idle";
        this.sendToDevice(dev.id, { t: "assign", name: dev.nextPlayer });
        break;
      }
      case "admin:queue:next": {
        const dev = this.devices.get(msg.deviceId);
        if (!dev || this.queue.length === 0) return;
        const name = this.queue.shift()!;
        dev.nextPlayer = name;
        if (!dev.live) dev.status = "ready";
        this.sendToDevice(dev.id, { t: "assign", name });
        break;
      }
      case "admin:rename": {
        const dev = this.devices.get(msg.deviceId);
        if (!dev) return;
        dev.label = cleanName(String(msg.label ?? "")) || dev.label;
        break;
      }
      case "admin:forget":
        this.devices.delete(msg.deviceId);
        break;
      case "admin:stop":
        this.sendToDevice(msg.deviceId, { t: "stop" });
        break;
      case "admin:reset": {
        // azzera subito lo stato sul server, anche se il dispositivo non risponde più
        const dev = this.devices.get(msg.deviceId);
        if (!dev) return;
        this.sendToDevice(dev.id, { t: "stop" });
        dev.live = null;
        dev.gameId = null;
        dev.status = "idle";
        break;
      }
      case "admin:stopAll":
        for (const c of this.conns) if (c.role === "device") this.send(c.ws, { t: "stop" });
        break;
      case "admin:reloadAll":
        for (const c of this.conns) if (c.role === "device" || c.role === "tv" || c.role === "spectator") this.send(c.ws, { t: "reload" });
        break;
      case "admin:queue:add": {
        const name = cleanName(String(msg.name ?? ""));
        if (name && this.queue.length < 50) this.queue.push(name);
        break;
      }
      case "admin:queue:remove":
        if (Number.isInteger(msg.index) && msg.index >= 0) this.queue.splice(msg.index, 1);
        break;
      case "admin:game:delete":
        this.store.remove(String(msg.id));
        break;
      case "admin:game:rename": {
        const player = cleanName(String(msg.player ?? ""));
        if (player) this.store.rename(String(msg.id), player);
        break;
      }
      case "admin:feed:info": {
        const text = String(msg.text ?? "").trim().slice(0, 120);
        if (text) this.pushFeed("info", text);
        break;
      }
      case "admin:settings":
        this.applySettings(msg.settings ?? {});
        break;
    }
    this.changed();
  }

  private applySettings(patch: Partial<Settings>): void {
    const s = { ...this.settings };
    if (patch.difficulty) {
      const d = patch.difficulty;
      const preset = d.preset in DIFFICULTY_PRESETS ? DIFFICULTY_PRESETS[d.preset as keyof typeof DIFFICULTY_PRESETS] : null;
      const base: Difficulty = preset ?? s.difficulty;
      s.difficulty =
        d.preset !== "personalizzata" && preset
          ? { ...preset }
          : {
              preset: "personalizzata",
              speed: clampMult(d.speed, base.speed),
              spawn: clampMult(d.spawn, base.spawn),
              enemies: clampMult(d.enemies, base.enemies),
              bossHp: clampMult(d.bossHp, base.bossHp),
              ramp: clampMult(d.ramp, base.ramp),
            };
    }
    for (const k of ["styleScreen", "styleVr", "styleAr"] as const) {
      if (patch[k] && STYLES.includes(patch[k] as VisualStyle)) s[k] = patch[k] as VisualStyle;
    }
    if (typeof patch.phoneNameRequired === "boolean") s.phoneNameRequired = patch.phoneNameRequired;
    this.settings = s;
    this.store.saveSettings(s);
    for (const c of this.conns) if (c.role === "device") this.send(c.ws, { t: "settings", settings: s });
    if (patch.difficulty) this.pushFeed("info", `Difficoltà: ${s.difficulty.preset}`);
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
        .map(({ gameId: _g, ...d }) => d)
        .sort((a, b) => Number(a.platform === "mobile") - Number(b.platform === "mobile") || a.label.localeCompare(b.label, "it", { numeric: true })),
      phones: this.phoneCount(),
      leaderboardToday: this.store.leaderboard(today, 15),
      leaderboardAll: this.store.leaderboard(null, 15),
      bestToday: this.store.bestPerPlayer(today, 50),
      last: this.lastGame(today),
      recent: this.store.recent(25),
      totalsToday: this.store.totals(today),
      totalsAll: this.store.totals(null),
      feed: this.feed,
      queue: this.queue,
      config: this.config(),
      settings: this.settings,
    };
  }

  private lastGame(today: string): Snapshot["last"] {
    const game = this.store.recent(1)[0];
    if (!game) return null;
    return { game, rankToday: game.day === today ? this.store.rankOf(game, today) : 0 };
  }

  private lastTop = "";
  private lastOthers = "";

  /** La top 5 di oggi ai dispositivi (solo quando cambia: costa pochissimo). */
  private sendTop(force?: Sock): void {
    const today = fairDay();
    const list = this.store.bestPerPlayer(today, 5).map((g) => ({ player: g.player, score: g.score, platform: g.platform }));
    const data = JSON.stringify({ t: "top", list, games: this.store.totals(today).games } satisfies ServerMsg);
    if (force) {
      this.sendRaw(force, data);
      return;
    }
    if (data === this.lastTop) return;
    this.lastTop = data;
    for (const c of this.conns) if (c.role === "device") this.sendRaw(c.ws, data);
  }

  /** Gli altri piloti in partita, per vederli dentro il visore (solo quando cambia). */
  private sendOthers(): void {
    const list: OtherPilot[] = [...this.devices.values()]
      .filter((d) => d.online && d.live)
      .sort((a, b) => b.live!.score - a.live!.score)
      .slice(0, 8)
      .map((d) => ({ id: d.id, label: d.label, player: d.live!.player, platform: d.platform, score: d.live!.score, wave: d.live!.wave, lives: d.live!.lives }));
    const key = JSON.stringify(list);
    if (key === this.lastOthers) return;
    this.lastOthers = key;
    for (const c of this.conns) {
      if (c.role !== "device") continue;
      this.send(c.ws, { t: "others", list: list.filter((o) => o.id !== c.deviceId) });
    }
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

  /** Raggruppa le modifiche: al massimo ~4 snapshot al secondo verso monitor, spettatore e operatore. */
  private changed(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const data = JSON.stringify({ t: "snapshot", data: this.snapshot() } satisfies ServerMsg);
      for (const c of this.conns) if (c.role === "tv" || c.role === "admin" || c.role === "spectator") this.sendRaw(c.ws, data);
      this.sendTop();
      this.sendOthers();
      this.updateWatch();
    }, 250);
  }

  // ---------------- spettatori ----------------

  /**
   * Decide chi segue ogni spettatore (scelta manuale, griglia con tutti o in automatico
   * la partita con più punti) e accende lo streaming solo sulle postazioni guardate.
   */
  private updateWatch(): void {
    const live = [...this.devices.values()].filter((d) => d.online && d.live).sort((a, b) => b.live!.score - a.live!.score);
    const best = live[0]?.id ?? null;
    const want = new Set<string>();
    for (const c of this.conns) {
      if (c.role !== "spectator") continue;
      if (c.grid) {
        for (const d of live.slice(0, 6)) want.add(d.id);
      }
      let target: string | null;
      if (c.pick && this.devices.get(c.pick)?.online) target = c.pick;
      else if (c.following && this.devices.get(c.following)?.live) {
        target = c.following;
        // cambia se un'altra partita va molto meglio da un po'
        const cur = this.devices.get(c.following)!.live!;
        const top = live[0]?.live;
        if (top && best !== c.following && top.score > cur.score * 1.3 + 500) target = best;
      } else target = best;
      // in automatico resta sulla partita appena finita per qualche secondo (si vede il game over)
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

  private relayFrame(deviceId: string, frame: unknown): void {
    if (!frame || typeof frame !== "object") return;
    const f = frame as { ents?: unknown; head?: unknown };
    if (!Array.isArray(f.ents) || f.ents.length > 400 || !Array.isArray(f.head)) return;
    const data = JSON.stringify({ t: "frame", data: { ...(frame as object), deviceId } });
    if (data.length > 48_000) return;
    for (const c of this.conns) {
      if (c.role === "spectator" && (c.following === deviceId || c.grid)) this.sendRaw(c.ws, data);
    }
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
