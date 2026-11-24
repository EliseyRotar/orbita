/**
 * Protocollo WebSocket condiviso tra server, postazioni di gioco, monitor, spettatore e operatore.
 * Tutti i messaggi sono JSON con un campo `t` (tipo).
 */

export type Platform = "desktop" | "vr" | "ar" | "mobile";
export type DeviceStatus = "idle" | "ready" | "playing" | "over";

export interface GameStats {
  score: number;
  kills: number;
  /** Navicelle nemiche abbattute. */
  enemies: number;
  shots: number;
  hits: number;
  maxCombo: number;
  bosses: number;
  wave: number;
  durationMs: number;
}

export interface LiveGame {
  player: string;
  score: number;
  lives: number;
  combo: number;
  wave: number;
  startedAt: number;
}

export interface DeviceInfo {
  id: string;
  label: string;
  platform: Platform;
  online: boolean;
  status: DeviceStatus;
  /** Nome del prossimo giocatore assegnato dall'operatore. */
  nextPlayer: string | null;
  live: LiveGame | null;
}

export interface GameRecord extends GameStats {
  id: string;
  player: string;
  platform: Platform;
  deviceLabel: string;
  endedAt: number;
  /** Giorno di fiera in formato YYYY-MM-DD (fuso Europe/Rome). */
  day: string;
}

export type FeedKind = "record" | "boss" | "combo" | "start" | "end" | "info";

export interface FeedItem {
  id: string;
  kind: FeedKind;
  text: string;
  at: number;
  /** Solo per i record: chi e con quanti punti. */
  record?: { player: string; score: number; scope: "fair" | "day" };
}

export interface Totals {
  games: number;
  kills: number;
  shots: number;
  hits: number;
  bosses: number;
  enemies: number;
  playMs: number;
  bestByPlatform: Partial<Record<Platform, { player: string; score: number }>>;
}

export interface PublicConfig {
  title: string;
  school: string;
  course: string;
  qrUrl: string;
  qrLabel: string;
  /** Indirizzo del gioco per i visori; vuoto = lo stesso sito della pagina. */
  playUrl: string;
}

export interface Snapshot {
  now: number;
  today: string;
  devices: DeviceInfo[];
  leaderboardToday: GameRecord[];
  leaderboardAll: GameRecord[];
  recent: GameRecord[];
  totalsToday: Totals;
  totalsAll: Totals;
  feed: FeedItem[];
  queue: string[];
  /** Telefoni dei visitatori collegati (non elencati uno per uno). */
  phones: { online: number; playing: number };
  config: PublicConfig;
}

/**
 * Fotogramma per lo spettatore: posizioni nel sistema di riferimento della partita
 * (x = destra, y = su, z = avanti, in unità di gioco, già divise per la scala AR).
 * Ogni entità: [id, tipo, x, y, z, rotazione].
 */
export type EntityKind = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ENT = { small: 0, medium: 1, large: 2, gold: 3, enemy: 4, mine: 5, bolt: 6 } as const;
export type FrameEntity = [id: number, kind: EntityKind, x: number, y: number, z: number, rot: number];

export interface GameFrame {
  /** Testa del giocatore: posizione e direzione dello sguardo. */
  head: [x: number, y: number, z: number, dx: number, dy: number, dz: number];
  ents: FrameEntity[];
  boss: [x: number, y: number, z: number, hp: number, max: number] | null;
  score: number;
  lives: number;
  combo: number;
  wave: number;
}

export interface SpectatorFrame extends GameFrame {
  deviceId: string;
}

// ---------- client -> server ----------

export type HelloMsg =
  | { t: "hello"; role: "device"; deviceId: string; label: string; platform: Platform }
  | { t: "hello"; role: "tv" }
  | { t: "hello"; role: "spectator" }
  | { t: "hello"; role: "admin"; pin?: string };

export type DeviceMsg =
  | { t: "device:platform"; platform: Platform }
  | { t: "device:label"; label: string }
  | { t: "game:start"; player: string }
  | { t: "game:tick"; score: number; lives: number; combo: number; wave: number }
  | { t: "game:event"; kind: FeedKind; text: string }
  | { t: "game:end"; stats: GameStats }
  | { t: "game:abort" }
  | { t: "game:frame"; frame: GameFrame };

export type SpectatorMsg = { t: "spectate:select"; deviceId: string | null };

export type AdminMsg =
  | { t: "admin:assign"; deviceId: string; name: string }
  | { t: "admin:unassign"; deviceId: string }
  | { t: "admin:rename"; deviceId: string; label: string }
  | { t: "admin:forget"; deviceId: string }
  | { t: "admin:stop"; deviceId: string }
  | { t: "admin:queue:add"; name: string }
  | { t: "admin:queue:remove"; index: number }
  | { t: "admin:queue:next"; deviceId: string }
  | { t: "admin:game:delete"; id: string }
  | { t: "admin:game:rename"; id: string; player: string }
  | { t: "admin:feed:info"; text: string };

export type ClientMsg = HelloMsg | DeviceMsg | AdminMsg | SpectatorMsg;

// ---------- server -> client ----------

export type ServerMsg =
  | { t: "snapshot"; data: Snapshot }
  | { t: "welcome"; role: "device" | "tv" | "admin" | "spectator" }
  | { t: "denied"; reason: string }
  | { t: "assign"; name: string | null }
  | { t: "stop" }
  /** Al dispositivo: qualcuno lo sta guardando, manda (o smetti di mandare) i fotogrammi. */
  | { t: "watch"; on: boolean }
  | { t: "frame"; data: SpectatorFrame }
  /** Allo spettatore: quale postazione sta seguendo adesso. */
  | { t: "following"; deviceId: string | null }
  | { t: "rank"; gameId: string; rankToday: number; rankAll: number; isRecord: boolean };

export const MAX_NAME_LEN = 18;

export function cleanName(raw: string): string {
  return raw.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LEN);
}

export function accuracy(s: Pick<GameStats, "shots" | "hits">): number {
  return s.shots > 0 ? Math.min(1, s.hits / s.shots) : 0;
}

export const PLATFORM_NAME: Record<Platform, string> = {
  desktop: "PC",
  vr: "Quest VR",
  ar: "HoloLens AR",
  mobile: "Telefono",
};
