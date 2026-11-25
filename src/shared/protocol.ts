/**
 * Protocollo WebSocket condiviso tra server, postazioni di gioco, monitor, spettatore e operatore.
 * Tutti i messaggi sono JSON con un campo `t` (tipo).
 */

export type Platform = "desktop" | "vr" | "ar" | "mobile";
/** "paused" = in pausa; "lost" = in partita ma non dà segni di vita da qualche secondo. */
export type DeviceStatus = "idle" | "ready" | "playing" | "paused" | "lost" | "over";

// ---------- impostazioni regolabili dal pannello operatore ----------

export type DifficultyPreset = "facile" | "normale" | "difficile" | "inferno" | "personalizzata";
export type VisualStyle = "neon" | "realistico" | "ologramma";

/** Moltiplicatori della difficoltà (1 = normale). */
export interface Difficulty {
  preset: DifficultyPreset;
  /** Velocità di asteroidi e proiettili nemici. */
  speed: number;
  /** Quantità di asteroidi (più alto = ne arrivano di più, più spesso). */
  spawn: number;
  /** Quante navicelle nemiche e quanto spesso sparano. */
  enemies: number;
  /** Vita del boss. */
  bossHp: number;
  /** Quanto in fretta sale la difficoltà da un'ondata all'altra. */
  ramp: number;
}

export const DIFFICULTY_PRESETS: Record<Exclude<DifficultyPreset, "personalizzata">, Difficulty> = {
  facile: { preset: "facile", speed: 0.8, spawn: 0.75, enemies: 0.6, bossHp: 0.7, ramp: 0.75 },
  normale: { preset: "normale", speed: 1, spawn: 1, enemies: 1, bossHp: 1, ramp: 1 },
  difficile: { preset: "difficile", speed: 1.2, spawn: 1.3, enemies: 1.4, bossHp: 1.4, ramp: 1.3 },
  inferno: { preset: "inferno", speed: 1.45, spawn: 1.7, enemies: 1.9, bossHp: 1.9, ramp: 1.7 },
};

export interface Settings {
  difficulty: Difficulty;
  /** Stile grafico per PC e telefoni, per il Quest (VR) e per gli HoloLens (AR). */
  styleScreen: VisualStyle;
  styleVr: VisualStyle;
  styleAr: VisualStyle;
  /** Se vero, dal telefono bisogna scrivere un nome per giocare. */
  phoneNameRequired: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  difficulty: DIFFICULTY_PRESETS.normale,
  styleScreen: "neon",
  styleVr: "realistico",
  styleAr: "ologramma",
  phoneNameRequired: true,
};

/** Una partita in corso, come la descrive il dispositivo (per riprenderla dopo una riconnessione). */
export interface CurrentGame {
  id: string;
  player: string;
  startedAt: number;
  score: number;
  lives: number;
  wave: number;
}

/** Altri piloti in gioco, mostrati dentro il visore. */
export interface OtherPilot {
  id: string;
  label: string;
  player: string;
  platform: Platform;
  score: number;
  wave: number;
  lives: number;
}

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
  /** Ultimo messaggio ricevuto (ms epoch). */
  lastSeen: number;
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
  /** Ultima partita giocata e la sua posizione di oggi (anche se fuori dalla top 10). */
  last: { game: GameRecord; rankToday: number } | null;
  /** Telefoni dei visitatori collegati (non elencati uno per uno). */
  phones: { online: number; playing: number };
  config: PublicConfig;
  settings: Settings;
  /** Classifica di oggi con la miglior partita di ogni giocatore (tutti, telefoni compresi). */
  bestToday: GameRecord[];
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
  /** Fotogrammi al secondo sul dispositivo e se la partita è in pausa. */
  fps?: number;
  paused?: boolean;
  /** Campo visivo del dispositivo (gradi orizzontali) e modalità, per lo spettatore. */
  fov?: number;
  mode?: "vr" | "ar" | "desktop" | "mobile";
}

export interface SpectatorFrame extends GameFrame {
  deviceId: string;
}

// ---------- client -> server ----------

export type HelloMsg =
  | { t: "hello"; role: "device"; deviceId: string; label: string; platform: Platform; game?: CurrentGame | null }
  | { t: "hello"; role: "tv" }
  | { t: "hello"; role: "spectator" }
  | { t: "hello"; role: "admin"; pin?: string };

export type DeviceMsg =
  | { t: "device:platform"; platform: Platform }
  | { t: "device:label"; label: string }
  | { t: "game:start"; player: string; id: string; startedAt: number }
  | { t: "game:tick"; score: number; lives: number; combo: number; wave: number }
  | { t: "game:event"; kind: FeedKind; text: string }
  | { t: "game:end"; stats: GameStats; id: string; player: string; startedAt: number }
  | { t: "game:pause"; paused: boolean }
  | { t: "game:abort" }
  | { t: "game:frame"; frame: GameFrame };

/** deviceId = null: automatico (il migliore); "all": tutti (griglia). */
export type SpectatorMsg = { t: "spectate:select"; deviceId: string | null } | { t: "spectate:grid"; on: boolean };

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
  | { t: "admin:feed:info"; text: string }
  | { t: "admin:reset"; deviceId: string }
  | { t: "admin:stopAll" }
  | { t: "admin:reloadAll" }
  | { t: "admin:settings"; settings: Partial<Settings> };

export type ClientMsg = HelloMsg | DeviceMsg | AdminMsg | SpectatorMsg;

// ---------- server -> client ----------

export type ServerMsg =
  | { t: "snapshot"; data: Snapshot }
  | { t: "welcome"; role: "device" | "tv" | "admin" | "spectator" }
  | { t: "denied"; reason: string }
  | { t: "assign"; name: string | null }
  | { t: "stop" }
  /** Ai dispositivi: impostazioni attuali (difficoltà, stile grafico). */
  | { t: "settings"; settings: Settings }
  /** Ai dispositivi: ricarica la pagina (dopo un aggiornamento). */
  | { t: "reload" }
  /** Ai dispositivi: gli altri piloti in partita. */
  | { t: "others"; list: OtherPilot[] }
  /** Ai dispositivi: la top 5 di oggi, da mostrare nel menu. */
  | { t: "top"; list: { player: string; score: number; platform: Platform }[]; games: number }
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
