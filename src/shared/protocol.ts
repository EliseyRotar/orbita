/**
 * Protocollo WebSocket condiviso tra server, postazioni di gioco, TV e pannello operatore.
 * Tutti i messaggi sono JSON con un campo `t` (tipo).
 */

export type Platform = "desktop" | "vr" | "ar" | "mobile";
export type DeviceStatus = "idle" | "ready" | "playing" | "over";

export interface GameStats {
  score: number;
  kills: number;
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
  playMs: number;
  bestByPlatform: Partial<Record<Platform, { player: string; score: number }>>;
}

export interface PublicConfig {
  title: string;
  school: string;
  course: string;
  qrUrl: string;
  qrLabel: string;
  qrSvg: string;
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
  config: PublicConfig;
}

// ---------- client -> server ----------

export type HelloMsg =
  | { t: "hello"; role: "device"; deviceId: string; label: string; platform: Platform }
  | { t: "hello"; role: "tv" }
  | { t: "hello"; role: "admin"; pin?: string };

export type DeviceMsg =
  | { t: "device:platform"; platform: Platform }
  | { t: "device:label"; label: string }
  | { t: "game:start"; player: string }
  | { t: "game:tick"; score: number; lives: number; combo: number; wave: number }
  | { t: "game:event"; kind: FeedKind; text: string }
  | { t: "game:end"; stats: GameStats }
  | { t: "game:abort" };

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

export type ClientMsg = HelloMsg | DeviceMsg | AdminMsg;

// ---------- server -> client ----------

export type ServerMsg =
  | { t: "snapshot"; data: Snapshot }
  | { t: "welcome"; role: "device" | "tv" | "admin" }
  | { t: "denied"; reason: string }
  | { t: "assign"; name: string | null }
  | { t: "stop" }
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
